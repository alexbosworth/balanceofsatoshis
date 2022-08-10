const asyncAuto = require('async/auto');
const asyncDetect = require('async/detect');
const asyncFilterLimit = require('async/filterLimit');
const asyncMap = require('async/map');
const {formatTokens} = require('ln-sync');
const {getAllInvoices} = require('ln-sync');
const {getPayment} = require('ln-service');
const moment = require('moment');
const {returnResult} = require('asyncjs-util');

const {segmentMeasure} = require('./../display');
const {sumsForSegment} = require('./../display');

const flatten = arr => [].concat(...arr);
const {isArray} = Array;
const isNumber = n => !isNaN(n);
const maxGetPayments = 100;
const mtokensAsTokens = n => Number(n / BigInt(1e3));
const notFound = 404;
const parseDate = n => Date.parse(n);

/** Get data for received payments chart

  {
    days: <Received Over Days Count Number>
    [end_date]: <End Date String>
    lnds: [<Authenticated LND API Object>]
    [start_date]: <Start Date String>
  }

  @returns via cbk or Promise
  {
    data: [<Received Tokens Number>]
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
          return cbk([400, 'ExpectedNumberOfDaysToGetFeesOverForChart']);
        }

        if (!isArray(args.lnds)) {
          return cbk([400, 'ExpectedLndToGetFeesChart']);
        }

        if (!args.lnds.length) {
          return cbk([400, 'ExpectedAnLndToGetFeesChart']);
        }

        if (!!args.start_date || !!args.end_date) {
          if (!args.start_date || !args.end_date) {
            return cbk([400, 'ExpectedStartAndEndDateToGetFeesChart']);
          }
          
          const startDate = parseDate(args.start_date);
          const endDate =  parseDate(args.end_date);

          if (!isNumber(startDate) || !isNumber(endDate)) {
            return cbk([400, 'FailedToParseStartAndEndDateToGetFeesChart']);
          }

          if (startDate > Date.now()) {
            return cbk([400, 'ExpectedPastStartDateToGetFeesChart']);
          }

          if (endDate > Date.now()) {
            return cbk([400, 'ExpectedPastEndDateToGetFeesChart']);
          }

          if (startDate > endDate) {
            return cbk([400, 'ExpectedStartDateToBeBeforeEndDateToGetFeesChart']);
          }
        }

        return cbk();
      },

      // Segment measure
      segment: ['validate', ({}, cbk) => {
        if (!args.start_date && !args.end_date) {
          return cbk(null, segmentMeasure({days: args.days}));
        }

        const days = moment(args.end_date).diff(args.start_date, 'days');
        return cbk(null, segmentMeasure({days}));
      }],

      // Start date for received payments
      start: ['validate', ({}, cbk) => {
        if (!!args.start_date) {
          return cbk(null, moment(args.start_date));
        }

        return cbk(null, moment().subtract(args.days, 'days'));
      }],

      // End date for received payments
      end: ['validate', ({}, cbk) => {
        if (!args.end_date) {
          return cbk();
        }
        
        return cbk(null, moment(args.end_date));
      }],

      // Get all the settled invoices using a subscription
      getSettled: ['end', 'start', ({end, start}, cbk) => {
        return asyncMap(args.lnds, (lnd, cbk) => {
          return getAllInvoices({
            lnd,
            confirmed_after: start.toISOString(),
          },
          cbk);
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          if (!!end) {
            return cbk(null, flatten(res.map(n => n.invoices)).filter(n => new Date(n.confirmed_at) <= new Date(end.toISOString())));
          }

          return cbk(null, flatten(res.map(n => n.invoices)));
        });
      }],

      // Eliminate self-payments by looking for payments with invoice ids
      getReceived: ['getSettled', ({getSettled}, cbk) => {
        return asyncFilterLimit(getSettled, maxGetPayments, (invoice, cbk) => {
          return asyncMap(args.lnds, (lnd, cbk) => {
            return getPayment({id: invoice.id, lnd}, (err, res) => {
              if (isArray(err) && err.shift() === notFound) {
                return cbk(null, false);
              }

              if (!!err) {
                return cbk(err);
              }

              return cbk(null, res.payment);
            });
          },
          (err, payments) => {
            if (!!err) {
              return cbk(err);
            }

            return cbk(null, !payments.filter(n => !!n).length);
          });
        },
        cbk);
      }],

      // Sum all of the invoices received amounts
      totalReceived: ['getReceived', ({getReceived}, cbk) => {
        const total = getReceived.reduce((sum, invoice) => {
          return sum + BigInt(invoice.received_mtokens);
        },
        BigInt(Number()));

        return cbk(null, mtokensAsTokens(total));
      }],

      // Earnings aggregated
      sum: ['getReceived', 'segment', ({getReceived, segment}, cbk) => {
        return cbk(null, sumsForSegment({
          measure: segment.measure,
          records: getReceived.map(invoice => {
            return {date: invoice.confirmed_at, tokens: invoice.received};
          }),
          segments: segment.segments,
        }));
      }],

      // Summary description of the received payments
      description: [
        'end',
        'getReceived',
        'segment',
        'start',
        'sum',
        'totalReceived',
        ({end, getReceived, segment, start, totalReceived, sum}, cbk) =>
      {
        const action = 'Received in';
        const {measure} = segment;
        const since = `since ${start.calendar().toLowerCase()}`;
        const to = !!end ? `to ${end.calendar().toLowerCase()}` : undefined;

        if (!!args.is_count) {
          const duration = `${action} ${sum.count.length} ${measure}s`;
          const total = `Total: ${getReceived.length} received payments`;

          if (!!to) {
            return cbk(null, `${duration} ${since} ${to}. ${total}`);
          }
 
          return cbk(null, `${duration} ${since}. ${total}`);
        } else {
          const duration = `${action} ${sum.sum.length} ${measure}s`;
          const total = formatTokens({tokens: totalReceived}).display;

          if (!!to) {
            return cbk(null, `${duration} ${since} ${to}. ${total}`);
          }

          return cbk(null, `${duration} ${since}. Total: ${total}`);
        }
      }],

      // Total activity
      data: ['description', 'sum', ({description, sum}, cbk) => {
        return cbk(null, {
          description,
          data: !args.is_count ? sum.sum : sum.count,
          title: !args.is_count ? 'Payments received' : 'Received count',
        });
      }],
    },
    returnResult({reject, resolve, of: 'data'}, cbk));
  });
};
