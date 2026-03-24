const asyncAuto = require('async/auto');
const asyncFilter = require('async/filter');
const asyncRetry = require('async/retry');
const {getChannel} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const rebalance = require('./rebalance');

const channelFromEdge = edge => edge.slice(0, -2);
const codeMissingChannel = 404;
const {isArray} = Array;
const isEdge = n => /^\d*x\d*x\d*x(0|1)*$/.test(n);
const joinWithNewLines = lines => lines.join('\n');
const matchNewLines = /\r?\n/;
const uniq = arr => Array.from(new Set(arr));

/** Manage rebalance attempts

  {
    [avoid]: [<Avoid Forwarding Through Node With Public Key Hex String>]
    fs: {
      getFile: <Read File Contents Function> (path, cbk) => {}
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

      // Get the avoid list and add it to the total avoids
      getAvoids: ['validate', ({}, cbk) => {
        // Exit early when there is no ignore list
        if (!args.avoid_list) {
          return cbk(null, {avoid: args.avoid, file: []});
        }

        return args.fs.getFile(args.avoid_list, (err, res) => {
          if (!!err) {
            return cbk([500, 'UnexpectedErrorFetchingAvoidList', {err}]);
          }

          const original = res.toString();

          const file = uniq(original
            .split(matchNewLines)
            .map(line => line.trim())
            .filter(line => !!line.length));

          return cbk(null, {
            file,
            original,
            avoid: file.concat(args.avoid || []),
          });
        });
      }],

      // Look at all of the lines in the file and clean them up
      getCleanAvoids: ['getAvoids', ({getAvoids}, cbk) => {
        return asyncFilter(getAvoids.file, (line, cbk) => {
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
      rebalance: ['getAvoids', ({getAvoids}, cbk) => {
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
            avoid: getAvoids.avoid,
            fs: args.fs,
            in_filters: args.in_filters,
            in_outbound: args.in_outbound,
            in_through: args.in_through,
            is_strict_max_fee_rate: args.is_strict_max_fee_rate,
            lnd: args.lnd,
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

      // Write a cleaned up avoid list
      writeCleanAvoidList: [
        'getAvoids',
        'getCleanAvoids',
        ({getAvoids, getCleanAvoids}, cbk) =>
      {
        // Exit early when there is no ignore list
        if (!args.avoid_list) {
          return cbk(null, {avoid: args.avoid, file: []});
        }

        const cleaned = joinWithNewLines(getCleanAvoids);

        // Exit early when the clean file is identical to the original
        if (getAvoids.original === cleaned) {
          return cbk();
        }

        return args.fs.writeFile(args.avoid_list, cleaned, err => {
          if (!!err) {
            return cbk([503, 'UnexpectedErrorWritingCleanedAvoidList', {err}]);
          }

          return cbk();
        });
      }],
    },
    returnResult({reject, resolve, of: 'rebalance'}, cbk));
  });
};
