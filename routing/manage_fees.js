const asyncAuto = require('async/auto');
const asyncForever = require('async/forever');
const {getBorderCharacters} = require('table');
const moment = require('moment');
const renderTable = require('table').table;
const {returnResult} = require('asyncjs-util');

const adjustFees = require('./adjust_fees');
const {formatDuration} = require('./../display');
const parseIntervalFormula = require('./../swaps/parse_interval_formula');

const border = getBorderCharacters('norc');
const calendarFormats = {sameElse: 'L [at] LT'};
const {isArray} = Array;

/** Manage routing fee adjustments

  {
    [cltv_delta]: <Set CLTV Delta Number>
    [fee_rate]: <Fee Rate String>
    fs: {
      getFile: <Read File Contents Function> (path, cbk) => {}
    }
    [inbound_rate_discount]: <Discount Fee Rate Number>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    [repeat_interval_ms]: <Repeat After Interval Milliseconds Formula String>
    to: [<Adjust Routing Fee To Peer Alias or Public Key or Tag String>]
  }

  @returns via cbk or Promise
  {
    rows: [[<Table Cell String>]]
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.fs) {
          return cbk([400, 'ExpectedFsMethodsToManageFees']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToManageFees']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToManageFees']);
        }

        if (isArray(args.repeat_interval_ms)) {
          return cbk([400, 'ExpectedSingleRepeatIntervalValue']);
        }

        return cbk();
      },

      // Check that the repeat interval formula is valid before starting
      interval: ['validate', ({}, cbk) => {
        // Exit early when the fee adjustment is not repeated
        if (args.repeat_interval_ms === undefined) {
          return cbk();
        }

        const {failure} = parseIntervalFormula({
          formula: args.repeat_interval_ms,
        });

        if (!!failure) {
          return cbk([400, 'FailedToParseRepeatIntervalFormula', {failure}]);
        }

        return cbk();
      }],

      // Adjust the fees
      adjust: ['interval', ({}, cbk) => {
        const execute = cbk => adjustFees({
          cltv_delta: args.cltv_delta,
          fee_rate: args.fee_rate,
          fs: args.fs,
          inbound_rate_discount: args.inbound_rate_discount,
          lnd: args.lnd,
          logger: args.logger,
          to: args.to,
        },
        cbk);

        // Exit early when the fees are only adjusted once
        if (args.repeat_interval_ms === undefined) {
          return execute(cbk);
        }

        // Adjust the fees again every time the interval elapses
        return asyncForever(cbk => {
          return execute((err, res) => {
            if (!!err) {
              args.logger.error({err});
            } else {
              args.logger.info(renderTable(res.rows, {border}));
            }

            // The interval formula is evaluated again after every attempt
            const {failure, ms} = parseIntervalFormula({
              formula: args.repeat_interval_ms,
            });

            if (!!failure) {
              return cbk([400, 'FailedToEvaluateRepeatInterval', {failure}]);
            }

            const next = moment().add(ms, 'ms');

            args.logger.info({
              repeat_interval: formatDuration({ms}).display,
              repeating_fees_at: next.calendar(null, calendarFormats),
            });

            return setTimeout(cbk, ms);
          });
        },
        cbk);
      }],
    },
    returnResult({reject, resolve, of: 'adjust'}, cbk));
  });
};
