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

const daysBetween = (a, b) => moment(a).diff(b, 'days') + 1;
const defaultDays = 60;
const flatten = arr => [].concat(...arr);
const {isArray} = Array;
const isDate = n => /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.test(n);
const maxGetPayments = 100;
const mtokensAsTokens = n => Number(n / BigInt(1e3));
const notFound = 404;
const {now} = Date;
const parseDate = n => Date.parse(n);

/** Get data for received payments chart

  {
    [days]: <Received Over Days Count Number>
    [end_date]: <End Date YYYY-MM-DD String>
    lnds: [<Authenticated LND API Object>]
    [start_date]: <Start Date YYYY-MM-DD String>
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
        if (!isArray(args.lnds)) {
          return cbk([400, 'ExpectedLndToGetFeesChart']);
        }

        if (!args.lnds.length) {
          return cbk([400, 'ExpectedAnLndToGetFeesChart']);
        }

        // Exit early when there is no end date and no start date
        if (!args.end_date && !args.start_date) {
          return cbk();
        }

        if (!!args.days) {
          return cbk([400, 'ExpectedEitherDaysOrDatesToGetFeesChart']);
        }

        if (!!args.end_date && !args.start_date) {
          return cbk([400, 'ExpectedStartDateToRangeToEndDate']);
        }

        if (!isDate(args.start_date)) {
          return cbk([400, 'ExpectedValidDateTypeForReceivedChartStartDate']);
        }

        if (!moment(args.start_date).isValid()) {
          return cbk([400, 'ExpectedValidEndDateForReceivedChartEndDate']);
        }

        if (parseDate(args.start_date) > now()) {
          return cbk([400, 'ExpectedPastStartDateToGetFeesChart']);
        }

        // Exit early when there is no end date
        if (!args.end_date) {
          return cbk();
        }

        if (args.start_date >= args.end_date) {
          return cbk([400, 'ExpectedStartDateBeforeEndDateToGetFeesChart']);
        }

        if (!isDate(args.end_date)) {
          return cbk([400, 'ExpectedValidDateFormatToForChartEndDate']);
        }

        if (!moment(args.end_date).isValid()) {
          return cbk([400, 'ExpectedValidEndDateForReceivedChartEndDate']);
        }

        if (parseDate(args.end_date) > now()) {
          return cbk([400, 'ExpectedPastEndDateToGetFeesChart']);
        }

        return cbk();
      },

      // End date for received payments
      end: ['validate', ({}, cbk) => {
        if (!args.end_date) {
          return cbk();
        }

        return cbk(null, moment(args.end_date));
      }],

      // Segment measure
      segment: ['validate', ({}, cbk) => {
        // Exit early when not looking at a date range
        if (!args.start_date && !args.end_date) {
          return cbk(null, segmentMeasure({days: args.days || defaultDays}));
        }

        const days = daysBetween(args.end_date, args.start_date);

        return cbk(null, segmentMeasure({
          days,
          end: args.end_date,
          start: args.start_date,
        }));
      }],

      // Start date for received payments
      start: ['validate', ({}, cbk) => {
        if (!!args.start_date) {
          return cbk(null, moment(args.start_date));
        }

        return cbk(null, moment().subtract(args.days || defaultDays, 'days'));
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

          const settled = flatten(res.map(n => n.invoices)).filter(invoice => {
            // Exit early when considering all invoices without an end point
            if (!args.end_date) {
              return true;
            }

            return moment(invoice.confirmed_at).isSameOrBefore(end, 'day');
          });

          return cbk(null, settled);
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
          end: args.end_date,
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
        const since = `from ${start.calendar().toLowerCase()}`;
        const to = !!end ? ` to ${end.calendar().toLowerCase()}` : '';

        if (!!args.is_count) {
          const duration = `${action} ${sum.count.length} ${measure}s`;
          const total = `Total: ${getReceived.length} received payments`;

          return cbk(null, `${duration} ${since}${to}. ${total}`);
        } else {
          const duration = `${action} ${sum.sum.length} ${measure}s`;
          const total = formatTokens({tokens: totalReceived}).display || '0';

          return cbk(null, `${duration} ${since}${to}. Total: ${total}`);
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
