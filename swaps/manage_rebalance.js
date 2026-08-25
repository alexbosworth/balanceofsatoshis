const asyncAuto = require('async/auto');
const asyncFilter = require('async/filter');
const asyncRetry = require('async/retry');
const {getChannel} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const appendFailingEdge = require('./append_failing_edge');
const getAvoidList = require('./get_avoid_list');
const rebalance = require('./rebalance');
const writeAvoidList = require('./write_avoid_list');

const channelFromEdge = edge => edge.slice(0, -2);
const codeMissingChannel = 404;
const {isArray} = Array;
const isEdge = n => /^\d*x\d*x\d*x(0|1)*$/.test(n);

/** Manage rebalance attempts

  {
    [avoid]: [<Avoid Forwarding Through Node With Public Key Hex String>]
    [avoid_append]: <Append Avoid Edges To Avoid List Matching Formula String>
    [avoid_list]: <Use Avoid Directives From File At Path String>
    fs: {
      appendFile: <Append to File Function> (path, content, cbk) => {}
      getFile: <Read File Contents Function> (path, cbk) => {}
      renameFile: <Rename File Function> (from, to, cbk) => {}
      writeFile: <Write File Contents Function> (path, contents, cbk) => {}
    }
    [in_filters]: [<Inbound Filter Formula String>]
    [in_outbound]: <Inbound Target Outbound Liquidity Tokens Number>
    [in_through]: <Pay In Through Peer String>
    [is_strict_max_fee_rate]: <Avoid Probing Too-High Fee Rate Routes Bool>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    [max_fee]: <Maximum Fee Tokens Number>
    [max_fee_rate]: <Max Fee Rate Tokens Per Million Number>
    [max_rebalance]: <Maximum Amount to Rebalance Tokens String>
    [node]: <Node Name String>
    [out_filters]: [<Outbound Filter Formula String>]
    [out_inbound]: <Outbound Target Inbound Liquidity Tokens Number>
    [out_through]: <Pay Out Through Peer String>
    [timeout_minutes]: <Deadline To Stop Rebalance Minutes Number>
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!!args.avoid_append && !args.avoid_list) {
          return cbk([400, 'ExpectedAvoidListToAppendAvoidsTo']);
        }

        if (!args.fs) {
          return cbk([400, 'ExpectedFsToManageRebalance']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToManageRebalance'])
        }

        if (isArray(args.max_fee)) {
          return cbk([400, 'ExpectedSingleMaxFeeValue']);
        }

        if (isArray(args.max_fee_rate)) {
          return cbk([400, 'ExpectedSingleMaxFeeValue']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToManageRebalance']);
        }

        return cbk();
      },

      // Get the avoid directives from the avoid list file
      getAvoids: ['validate', ({}, cbk) => {
        // Exit early when there is no ignore list
        if (!args.avoid_list) {
          return cbk(null, {lines: []});
        }

        return getAvoidList({
          fs: {getFile: args.fs.getFile},
          path: args.avoid_list,
        },
        cbk);
      }],

      // Get the graph sync status to know if missing channels are reliable
      getGraphSyncStatus: ['validate', ({}, cbk) => {
        // Exit early when there is no ignore list to clean
        if (!args.avoid_list) {
          return cbk();
        }

        return getWalletInfo({lnd: args.lnd}, cbk);
      }],

      // Create failing edge logger for avoid appending
      logFail: ['validate', ({}, cbk) => {
        // Exit early when there is no avoid appending
        if (!args.avoid_append) {
          return cbk();
        }

        return cbk(null, (err, failure) => {
          return appendFailingEdge({
            failure,
            avoid: args.avoid_append,
            fs: args.fs,
            list: args.avoid_list
          },
          (err, res) => {
            if (!!err) {
              return args.logger.error({append_failure_error: err});
            }

            // Exit early when there was no append
            if (!res.edge) {
              return;
            }

            return args.logger.info({appended_failing_edge: res.edge});
          });
        });
      }],

      // Look at all of the lines in the file and clean them up
      getCleanAvoids: [
        'getAvoids',
        'getGraphSyncStatus',
        ({getAvoids, getGraphSyncStatus}, cbk) =>
      {
        // Exit early with no info when missing channels may be resurrected
        if (!!getGraphSyncStatus && !getGraphSyncStatus.is_synced_to_graph) {
          return cbk();
        }

        return asyncFilter(getAvoids.lines, (line, cbk) => {
          // Exit early when not looking at an edge
          if (!isEdge(line)) {
            return cbk(null, true);
          }

          const id = channelFromEdge(line);

          return getChannel({id, lnd: args.lnd}, err => {
            const [code] = err || [];

            if (code === codeMissingChannel) {
              args.logger.info({deleting_missing_channel: id});
            }

            return cbk(null, code !== codeMissingChannel);
          });
        },
        cbk);
      }],

      // Run the rebalance
      rebalance: ['getAvoids', 'logFail', ({getAvoids, logFail}, cbk) => {
        const start = new Date().toISOString();

        return asyncRetry({
          errorFilter: err => {
            // Do not retry on invalid errors
            if (!isArray(err)) {
              return false;
            }

            const [code, type] = err;

            // Do not retry on client errors
            if (code >= 400 && code < 500) {
              return false;
            }

            // Do not retry on timeout errors
            if (code === 503 && type === 'ProbeTimeout') {
              return false;
            }

            args.logger.error({err});

            return true;
          },
        },
        cbk => {
          return rebalance({
            start,
            avoid: getAvoids.lines.concat(args.avoid || []),
            fs: args.fs,
            in_filters: args.in_filters,
            in_outbound: args.in_outbound,
            in_through: args.in_through,
            is_strict_max_fee_rate: args.is_strict_max_fee_rate,
            lnd: args.lnd,
            log_failure: logFail || undefined,
            logger: args.logger,
            max_fee: Number(args.max_fee) || undefined,
            max_fee_rate: Number(args.max_fee_rate) || undefined,
            max_rebalance: args.max_rebalance,
            out_filters: args.out_filters,
            out_inbound: args.out_inbound,
            out_through: args.out_through,
            timeout_minutes: args.timeout_minutes,
          },
          cbk);
        },
        cbk);
      }],

      // Determine which lines should be removed from the avoid list
      removals: [
        'getAvoids',
        'getCleanAvoids',
        ({getAvoids, getCleanAvoids}, cbk) =>
      {
        // Exit early with no removals when the clean check had no answer
        if (!getCleanAvoids) {
          return cbk(null, []);
        }

        // The clean avoids are the original lines minus missing channels
        const keeping = new Set(getCleanAvoids);

        // A line that was not kept refers to a channel absent from the graph
        return cbk(null, getAvoids.lines.filter(n => !keeping.has(n)));
      }],

      // Get the avoid list again to preserve concurrently appended lines
      getCurrentAvoids: ['removals', ({removals}, cbk) => {
        // Exit early when no lines were cleaned out of the avoid list
        if (!removals.length) {
          return cbk();
        }

        return getAvoidList({
          fs: {getFile: args.fs.getFile},
          path: args.avoid_list,
        },
        cbk);
      }],

      // Write a cleaned up avoid list
      writeCleanAvoidList: [
        'getCurrentAvoids',
        'removals',
        ({getCurrentAvoids, removals}, cbk) =>
      {
        // Exit early when there is no cleaned avoid list to write out
        if (!getCurrentAvoids) {
          return cbk();
        }

        const removing = new Set(removals);

        // Atomically write the avoid list without the cleaned out lines
        return writeAvoidList({
          fs: {renameFile: args.fs.renameFile, writeFile: args.fs.writeFile},
          lines: getCurrentAvoids.lines.filter(n => !removing.has(n)),
          path: args.avoid_list,
        },
        cbk);
      }],
    },
    returnResult({reject, resolve, of: 'rebalance'}, cbk));
  });
};
