const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {formatTokens} = require('ln-sync');
const {getChainTransactions} = require('ln-service');
const moment = require('moment');
const {returnResult} = require('asyncjs-util');

const feesForSegment = require('./fees_for_segment');

const daysPerWeek = 7;
const flatten = arr => [].concat(...arr);
const {floor} = Math;
const hoursPerDay = 24;
const {isArray} = Array;
const {keys} = Object;
const minChartDays = 4;
const maxChartDays = 90;
const tokensAsBigUnit = tokens => (tokens / 1e8).toFixed(8);

/** Get Blockchain fees paid

  {
    days: <Chain Fees Paid Over Days Count Number>
    is_monochrome: <Omit Colors Bool>
    lnds: [<Authenticated LND API Object>]
  }

  @returns via cbk or Promise
  {
    data: [<Chain Fee Tokens Number>]
    description: <Chart Description String>
    title: <Chart Title String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.days) {
          return cbk([400, 'ExpectedNumberOfDaysToGetChainFeesOverForChart']);
        }

        if (!isArray(args.lnds) || !args.lnds.length) {
          return cbk([400, 'ExpectedLndToGetChainFeesChart']);
        }

        return cbk();
      },

      // Get chain transactions
      getTransactions: ['validate', ({}, cbk) => {
        return asyncMap(args.lnds, (lnd, cbk) => {
          return getChainTransactions({lnd}, cbk);
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          return cbk(null, flatten(res.map(({transactions}) => transactions)));
        });
      }],

      // Segment measure
      measure: ['validate', ({}, cbk) => {
        if (args.days > maxChartDays) {
          return cbk(null, 'week');
        } else if (args.days < minChartDays) {
          return cbk(null, 'hour');
        } else {
          return cbk(null, 'day');
        }
      }],

      // Start date for payments
      start: ['validate', ({}, cbk) => {
        return cbk(null, moment().subtract(args.days, 'days'));
      }],

      // Total number of segments
      segments: ['measure', ({measure}, cbk) => {
        switch (measure) {
        case 'hour':
          return cbk(null, hoursPerDay * args.days);

        case 'week':
          return cbk(null, floor(args.days / daysPerWeek));

        default:
          return cbk(null, args.days);
        }
      }],

      // Filter the transactions by date
      transactions: [
        'getTransactions',
        'start',
        ({getTransactions, start}, cbk) =>
      {
        const transactions = getTransactions.filter(tx => {
          if (!tx.is_confirmed) {
            return false;
          }

          return !!tx.fee && tx.created_at > start.toISOString();
        });

        return cbk(null, transactions);
      }],

      // Total paid
      total: ['transactions', ({transactions}, cbk) => {
        const paid = transactions.reduce((sum, {fee}) => sum + fee, Number());

        return cbk(null, paid);
      }],

      // Payments activity aggregated
      sum: [
        'measure',
        'segments',
        'transactions',
        ({measure, segments, transactions}, cbk) =>
      {
        return cbk(null, feesForSegment({
          forwards: transactions,
          measure,
          segments,
        }));
      }],

      // Summary description of the chain fees paid
      description: [
        'measure',
        'start',
        'sum',
        'total',
        async ({measure, start, sum, total}) =>
      {
        const duration = `Chain fees paid in ${sum.fees.length} ${measure}s`;
        const since = `since ${start.calendar().toLowerCase()}`;

        const {display} = formatTokens({
          is_monochrome: args.is_monochrome,
          tokens: total,
        });

        return `${duration} ${since}. Total: ${display}`;
      }],

      // Fees paid
      data: ['description', 'sum', ({description, sum}, cbk) => {
        const data = sum.fees;
        const title = 'Chain fees paid';

        return cbk(null, {data, description, title});
      }],
    },
    returnResult({reject, resolve, of: 'data'}, cbk));
  });
};
