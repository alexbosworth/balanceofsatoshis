const asyncAuto = require('async/auto');
const asyncForever = require('async/forever');
const moment = require('moment');
const {returnResult} = require('asyncjs-util');

const executeRebalance = require('./execute_rebalance');
const {formatDuration} = require('./../display');
const parseIntervalFormula = require('./parse_interval_formula');

const calendarFormats = {sameElse: 'L [at] LT'};
const {isArray} = Array;

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
    [repeat_interval_ms]: <Repeat After Interval Milliseconds Formula String>
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

        if (isArray(args.repeat_interval_ms)) {
          return cbk([400, 'ExpectedSingleRepeatIntervalValue']);
        }

        return cbk();
      },

      // Check that the repeat interval formula is valid before starting
      interval: ['validate', ({}, cbk) => {
        // Exit early when the rebalance is not repeated
        if (args.repeat_interval_ms === undefined) {
          return cbk();
        }

        const {failure} = parseIntervalFormula({
          failures: Number(),
          formula: args.repeat_interval_ms,
        });

        if (!!failure) {
          return cbk([400, 'FailedToParseRepeatIntervalFormula', {failure}]);
        }

        return cbk();
      }],

      // Run the rebalance
      rebalance: ['interval', ({}, cbk) => {
        const execute = cbk => executeRebalance({
          avoid: args.avoid,
          avoid_append: args.avoid_append,
          avoid_list: args.avoid_list,
          fs: args.fs,
          in_filters: args.in_filters,
          in_outbound: args.in_outbound,
          in_through: args.in_through,
          is_strict_max_fee_rate: args.is_strict_max_fee_rate,
          lnd: args.lnd,
          logger: args.logger,
          max_fee: args.max_fee,
          max_fee_rate: args.max_fee_rate,
          max_rebalance: args.max_rebalance,
          out_filters: args.out_filters,
          out_inbound: args.out_inbound,
          out_through: args.out_through,
          timeout_minutes: args.timeout_minutes,
        },
        cbk);

        // Exit early when the rebalance is only run once
        if (args.repeat_interval_ms === undefined) {
          return execute(cbk);
        }

        let failures = Number();

        // Run the rebalance again every time the interval elapses
        return asyncForever(cbk => {
          return execute((err, res) => {
            if (!!err) {
              args.logger.error({err});
            } else {
              args.logger.info(res);
            }

            // Count failed attempts in a row for the interval formula
            failures = !!err ? failures + 1 : Number();

            // The interval formula is evaluated again after every attempt
            const {failure, ms} = parseIntervalFormula({
              failures,
              formula: args.repeat_interval_ms,
            });

            if (!!failure) {
              return cbk([400, 'FailedToEvaluateRepeatInterval', {failure}]);
            }

            const next = moment().add(ms, 'ms');

            args.logger.info({
              repeat_interval: formatDuration({ms}).display,
              repeating_rebalance_at: next.calendar(null, calendarFormats),
            });

            return setTimeout(cbk, ms);
          });
        },
        cbk);
      }],
    },
    returnResult({reject, resolve, of: 'rebalance'}, cbk));
  });
};
