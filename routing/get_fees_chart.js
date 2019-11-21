const asyncAuto = require('async/auto');
const {getForwards} = require('ln-service');
const moment = require('moment');
const {returnResult} = require('asyncjs-util');

const daysPerWeek = 7;
const {floor} = Math;
const hoursPerDay = 24;
const limit = 99999;
const minChartDays = 4;
const maxChartDays = 90;

/** Get data for fees chart

  {
    days: <Fees Earned Over Days Count Number>
    lnd: <Authenticated LND gRPC API Object>
  }

  @returns via cbk or Promise
  {
    description: <Chart Description String>
    fees: [<Earned Fee Tokens Number>]
  }
*/
module.exports = ({days, lnd}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!days) {
          return cbk([400, 'ExpectedNumberOfDaysToGetFeesOverForChart']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndToGetFeesChart']);
        }

        return cbk();
      },

      // Segment measure
      measure: ['validate', ({}, cbk) => {
        if (days > maxChartDays) {
          return cbk(null, 'week');
        } else if (days < minChartDays) {
          return cbk(null, 'hour');
        } else {
          return cbk(null, 'day');
        }
      }],

      // Start date for forwards
      start: ['validate', ({}, cbk) => {
        return cbk(null, moment().subtract(days, 'days'));
      }],

      // Get forwards
      getForwards: ['start', ({start}, cbk) => {
        return getForwards({
          limit,
          lnd,
          after: start.toISOString(),
          before: new Date().toISOString(),
        },
        cbk);
      }],

      // Total earnings
      totalEarned: ['getForwards', ({getForwards}, cbk) => {
        const {forwards} = getForwards;

        return cbk(null, forwards.reduce((sum, {fee}) => sum + fee, Number()));
      }],

      // Total number of segments
      segments: ['measure', ({measure}, cbk) => {
        switch (measure) {
        case 'hour':
          return cbk(null, hoursPerDay * days);

        case 'week':
          return cbk(null, floor(days / daysPerWeek));

        default:
          return cbk(null, days);
        }
      }],

      // Fees earned
      fees: [
        'getForwards',
        'measure',
        'segments',
        ({getForwards, measure, segments}, cbk) =>
      {
        const fees = [...Array(segments)].map((_, i) => {
          const segment = moment().subtract(i, measure);

          const segmentForwards = getForwards.forwards.filter(forward => {
            const forwardDate = moment(forward.created_at);

            if (segment.year() !== forwardDate.year()) {
              return false;
            }

            const isSameDay = segment.dayOfYear() === forwardDate.dayOfYear();

            switch (measure) {
            case 'hour':
              return isSameDay && segment.hour() === forwardDate.hour();

            case 'week':
              return segment.week() === forwardDate.week();

            default:
              return isSameDay;
            }
          });

          return segmentForwards.reduce((sum, {fee}) => sum + fee, Number());
        });

        return cbk(null, fees.slice().reverse());
      }],

      // Summary description of the fees earned
      description: [
        'fees',
        'measure',
        'start',
        'totalEarned',
        ({fees, measure, start, totalEarned}, cbk) =>
      {
        const feesEarned = `Fees earned in ${fees.length} ${measure}s`;
        const since = `since ${start.calendar()}`;
        const earned = (totalEarned / 1e8).toFixed(8);

        return cbk(null, `${feesEarned} ${since}. Total: ${earned}`);
      }],

      // Earnings
      earnings: ['description', 'fees', ({description, fees}, cbk) => {
        return cbk(null, {description, fees});
      }],
    },
    returnResult({reject, resolve, of: 'earnings'}, cbk));
  });
};
