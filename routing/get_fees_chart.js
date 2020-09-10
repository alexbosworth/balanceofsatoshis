const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {formatTokens} = require('ln-sync');
const {getNode} = require('ln-service');
const moment = require('moment');
const {returnResult} = require('asyncjs-util');

const feesForSegment = require('./fees_for_segment');
const getForwards = require('./get_forwards');

const asDate = n => n.toISOString();
const daysPerWeek = 7;
const {floor} = Math;
const hoursPerDay = 24;
const {isArray} = Array;
const minChartDays = 4;
const maxChartDays = 90;

/** Get data for fees chart

  {
    days: <Fees Earned Over Days Count Number>
    is_count: <Return Only Count of Forwards Bool>
    lnds: [<Authenticated LND API Object>]
    via: <Via Public Key Hex String>
  }

  @returns via cbk or Promise
  {
    data: [<Earned Fee Tokens Number>]
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

        return cbk();
      },

      // Get node details
      getNode: ['validate', ({}, cbk) => {
        // Exit early when there is no via node specified
        if (!args.via) {
          return cbk();
        }

        const [lnd] = args.lnds;

        return getNode({
          lnd,
          is_omitting_channels: true,
          public_key: args.via,
        },
        cbk);
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

      // Start date for forwards
      start: ['validate', ({}, cbk) => {
        return cbk(null, moment().subtract(args.days, 'days'));
      }],

      // Get forwards
      getForwards: ['start', ({start}, cbk) => {
        return asyncMap(args.lnds, (lnd, cbk) => {
          return getForwards({lnd, after: asDate(start), via: args.via}, cbk);
        },
        cbk);
      }],

      // Filter the forwards
      forwards: ['getForwards', ({getForwards}, cbk) => {
        const forwards = getForwards.map(({forwards}) => forwards);

        return cbk(null, forwards.reduce((sum, n) => sum.concat(n), []));
      }],

      // Total earnings
      totalEarned: ['forwards', ({forwards}, cbk) => {
        return cbk(null, forwards.reduce((sum, {fee}) => sum + fee, Number()));
      }],

      // Total forwarded
      totalForwarded: ['forwards', ({forwards}, cbk) => {
        const total = forwards.reduce((sum, n) => sum + n.tokens, Number());

        return cbk(null, total);
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

      // Forwarding activity aggregated
      sum: [
        'forwards',
        'measure',
        'segments',
        ({forwards, measure, segments}, cbk) =>
      {
        return cbk(null, feesForSegment({forwards, measure, segments}));
      }],

      // Summary description of the fees earned
      description: [
        'forwards',
        'measure',
        'start',
        'sum',
        'totalEarned',
        'totalForwarded',
        ({forwards, measure, start, totalEarned, totalForwarded, sum}, cbk) =>
      {
        const since = `since ${start.calendar().toLowerCase()}`;

        if (!!args.is_count) {
          const duration = `Forwarded in ${sum.count.length} ${measure}s`;
          const forwarded = `Total: ${forwards.length} forwards`;

          return cbk(null, `${duration} ${since}. ${forwarded}`);
        } else if (!!args.is_forwarded) {
          const duration = `Forwarded in ${sum.count.length} ${measure}s`;

          const {display} = formatTokens({tokens: totalForwarded});

          return cbk(null, `${duration} ${since}. Total: ${display}`);
        } else {
          const duration = `Earned in ${sum.fees.length} ${measure}s`;
          const earned = (totalEarned / 1e8).toFixed(8);

          return cbk(null, `${duration} ${since}. Total: ${earned}`);
        }
      }],

      // Heading
      head: ['validate', ({}, cbk) => {
        if (!!args.is_count) {
          return cbk(null, 'Forwards count');
        }

        if (!!args.is_forwarded) {
          return cbk(null, 'Forwarded amount');
        }

        return cbk(null, 'Routing fees earned');
      }],

      // Summary title of the fees earned
      title: ['getNode', 'head', ({getNode, head}, cbk) => {
        if (!args.via) {
          return cbk(null, head);
        }

        const {alias} = getNode;

        return cbk(null, `${head} via ${alias || args.via}`);
      }],

      // Forwarding activity
      data: [
        'description',
        'sum',
        'title',
        ({description, sum, title}, cbk) =>
      {
        if (!!args.is_count) {
          return cbk(null, {description, title, data: sum.count});
        }

        if (!!args.is_forwarded) {
          return cbk(null, {description, title, data: sum.forwarded});
        }

        return cbk(null, {description, title, data: sum.fees});
      }],
    },
    returnResult({reject, resolve, of: 'data'}, cbk));
  });
};
