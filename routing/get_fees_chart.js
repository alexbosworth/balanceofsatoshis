const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {formatTokens} = require('ln-sync');
const {getNodeAlias} = require('ln-sync');
const moment = require('moment');
const {returnResult} = require('asyncjs-util');

const feesForSegment = require('./fees_for_segment');
const {getFiatRates} = require('./../balances');
const {getTags} = require('./../tags');
const getForwards = require('./get_forwards');

const asDate = n => !!n ? n.toISOString() : undefined;
const daysBetween = (a, b) => moment(a).diff(b, 'days') + 1;
const daysPerWeek = 7;
const defaultDays = 60;
const fiatOfMtokens = (cents, mtokens) => Number(mtokens) / 1e11 * cents / 100;
const fiatOfTokens = (cents, tokens) => tokens / 1e8 * cents / 100;
const {floor} = Math;
const formatFiat = (amount, fiat) => `${amount.toFixed(2)} ${fiat}`;
const hoursCount = (a, b) => moment(a).diff(b, 'hours') + 1;
const hoursPerDay = 24;
const {isArray} = Array;
const isDate = n => /^\d{4}(-(0[1-9]|1[0-2]))?(-(0[1-9]|[12][0-9]|3[01]))?$/.test(n);
const minChartDays = 4;
const maxChartDays = 90;
const {now} = Date;
const parseDate = n => Date.parse(n);
const tokensAsBigUnit = tokens => (tokens / 1e8).toFixed(8);

/** Get data for fees chart

  {
    [days]: <Fees Earned Over Days Count Number>
    [end_date]: <End Date YYYY-MM-DD String>
    fs: {
      getFile: <Get File Function>
      [makeDirectory]: <Make Directory Function> (path, cbk) => {}
      [renameFile]: <Rename File Function> (from, to, cbk) => {}
      [writeFile]: <Write File Contents Function> (path, contents, cbk) => {}
    }
    is_count: <Return Only Count of Forwards Bool>
    [is_fiat]: <Value Amounts in Fiat Bool>
    [is_forwarded]: <Return Amount Forwarded Bool>
    lnds: [<Authenticated LND API Object>]
    [logger]: <Winston Logger Object>
    [start_date]: <Start Date YYYY-MM-DD String>
    [via]: <Via Public Key Hex or Tag Id or Alias String>
  }

  @returns via cbk or Promise
  {
    data: [<Earned Fee Tokens or Fiat Amount Number>]
    description: <Chart Description String>
    title: <Chart Title String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.fs) {
          return cbk([400, 'ExpectedFileSystemMethodsToGetFeesChart']);
        }

        if (!isArray(args.lnds)) {
          return cbk([400, 'ExpectedLndToGetFeesChart']);
        }

        if (!args.lnds.length) {
          return cbk([400, 'ExpectedAnLndToGetFeesChart']);
        }

        if (!!args.is_count && !!args.is_fiat) {
          return cbk([400, 'ExpectedEitherCountOrFiatForFeesChart']);
        }

        // Exit early when there is no end date and no start date
        if (!args.end_date && !args.start_date) {
          return cbk();
        }

        if (!!args.days) {
          return cbk([400, 'ExpectedEitherDaysOrDatesToGetFeesChart']);
        }

        if (!!args.end_date && !args.start_date) {
          return cbk([400, 'ExpectedStartDateToRangeToEndDateForFeesChart']);
        }

        if (!isDate(args.start_date)) {
          return cbk([400, 'ExpectedValidDateTypeForFeesChartStartDate']);
        }

        if (!moment(args.start_date).isValid()) {
          return cbk([400, 'ExpectedValidStartDateForFeesChartEndDate']);
        }

        if (parseDate(args.start_date) > now()) {
          return cbk([400, 'ExpectedPastStartDateToGetFeesChart']);
        }

        // Exit early when there is no end date
        if (!args.end_date) {
          return cbk();
        }

        if (args.start_date > args.end_date) {
          return cbk([400, 'ExpectedStartDateBeforeEndDateForFeesChart']);
        }

        if (!isDate(args.end_date)) {
          return cbk([400, 'ExpectedValidDateFormatForFeesChartEndDate']);
        }

        if (!moment(args.end_date).isValid()) {
          return cbk([400, 'ExpectedValidEndDateForFeesChartEndDate']);
        }

        if (parseDate(args.end_date) > now()) {
          return cbk([400, 'ExpectedPastEndDateToGetFeesChart']);
        }

        return cbk();
      },

      // End date for getting fee earnings
      end: ['validate', ({}, cbk) => {
        if (!args.end_date) {
          return cbk();
        }

        return cbk(null, moment(args.end_date).endOf('day'));
      }],

      // Calculate the start date
      start: ['validate', ({}, cbk) => {
        if (!!args.start_date) {
          return cbk(null, moment(args.start_date));
        }

        return cbk(null, moment().subtract(args.days || defaultDays, 'days'));
      }],

      // Determine how many days to chart over
      days: ['validate', ({}, cbk) => {
        // Exit early when not using a date range
        if (!args.start_date) {
          return cbk(null, args.days || defaultDays);
        }

        return cbk(null, daysBetween(args.end_date, args.start_date));
      }],

      // Get the list of tags to look for a via match
      getTags: ['validate', ({}, cbk) => {
        if (!args.via) {
          return cbk();
        }

        return getTags({fs: args.fs}, cbk);
      }],

      // Segment measure
      measure: ['days', ({days}, cbk) => {
        if (days > maxChartDays) {
          return cbk(null, 'week');
        } else if (days < minChartDays) {
          return cbk(null, 'hour');
        } else {
          return cbk(null, 'day');
        }
      }],

      // Determine via tag
      viaTag: ['getTags', ({getTags}, cbk) => {
        // Exit early when there is no via filter
        if (!args.via) {
          return cbk();
        }

        const tagById = getTags.tags.find(({id}) => id === args.via);

        if (!!tagById) {
          return cbk(null, tagById);
        }

        const tagByAlias = getTags.tags.find(({alias}) => alias === args.via);

        if (!!tagByAlias) {
          return cbk(null, tagByAlias);
        }

        return cbk();
      }],

      // Get node details
      getNode: ['viaTag', ({viaTag}, cbk) => {
        // Exit early when there is no via node specified
        if (!args.via) {
          return cbk();
        }

        // Exit early when via is a tag match
        if (!!viaTag) {
          return cbk();
        }

        const [lnd] = args.lnds;

        return getNodeAlias({lnd, id: args.via}, cbk);
      }],

      // Fees via nodes
      via: ['viaTag', ({viaTag}, cbk) => {
        if (!!viaTag) {
          return cbk(null, viaTag.nodes);
        }

        if (!!args.via) {
          return cbk(null, [args.via]);
        }

        return cbk();
      }],

      // Get forwards
      getForwards: ['start', 'end', 'via', ({start, end, via}, cbk) => {
        return asyncMap(args.lnds, (lnd, cbk) => {
          return getForwards({
            lnd,
            via,
            after: asDate(start), 
            before: asDate(end),
          }, 
          cbk);
        },
        cbk);
      }],

      // Filter the forwards
      forwards: ['getForwards', ({getForwards}, cbk) => {
        const forwards = getForwards.map(({forwards}) => forwards);

        return cbk(null, forwards.reduce((sum, n) => sum.concat(n), []));
      }],

      // Get the fiat rates at the times of the forwards
      getRates: ['forwards', ({forwards}, cbk) => {
        // Exit early when amounts are not valued in fiat
        if (!args.is_fiat) {
          return cbk();
        }

        return getFiatRates({
          dates: forwards.map(n => n.created_at),
          fs: args.fs,
          lnds: args.lnds,
          logger: args.logger,
        },
        cbk);
      }],

      // Forwards with fees and amounts in fiat when valued in fiat
      valued: ['forwards', 'getRates', ({forwards, getRates}, cbk) => {
        // Exit early when amounts are not valued in fiat
        if (!getRates) {
          return cbk(null, forwards);
        }

        return cbk(null, forwards.map((forward, i) => {
          const {cents} = getRates.rates[i];

          return {
            created_at: forward.created_at,
            fee: fiatOfMtokens(cents, forward.fee_mtokens),
            tokens: fiatOfTokens(cents, forward.tokens),
          };
        }));
      }],

      // Total earnings
      totalEarned: ['valued', ({valued}, cbk) => {
        return cbk(null, valued.reduce((sum, {fee}) => sum + fee, Number()));
      }],

      // Total forwarded
      totalForwarded: ['valued', ({valued}, cbk) => {
        const total = valued.reduce((sum, n) => sum + n.tokens, Number());

        return cbk(null, total);
      }],

      // Total of the charted amounts for display
      total: [
        'getRates',
        'totalEarned',
        'totalForwarded',
        ({getRates, totalEarned, totalForwarded}, cbk) =>
      {
        const total = !!args.is_forwarded ? totalForwarded : totalEarned;

        // Exit early when the total is a fiat amount
        if (!!getRates) {
          return cbk(null, formatFiat(total, getRates.fiat));
        }

        // Exit early when the total is an amount forwarded
        if (!!args.is_forwarded) {
          return cbk(null, formatTokens({tokens: total}).display);
        }

        return cbk(null, tokensAsBigUnit(total));
      }],

      // Total number of segments
      segments: ['days', 'end', 'measure', ({days, end, measure}, cbk) => {
        switch (measure) {
        case 'hour':
          // Exit early when using full days
          if (!args.start_date) {
            return cbk(null, hoursPerDay * days);
          }

          return cbk(null, hoursCount(end, args.start_date));

        case 'week':
          return cbk(null, floor(days / daysPerWeek));

        default:
          return cbk(null, days);
        }
      }],

      // Forwarding activity aggregated
      sum: [
        'end',
        'measure',
        'segments',
        'valued',
        ({end, measure, segments, valued}, cbk) =>
      {
        return cbk(null, feesForSegment({
          measure,
          segments,
          end: !!end ? end.toISOString() : undefined,
          forwards: valued,
        }));
      }],

      // Summary description of the fees earned
      description: [
        'end',
        'forwards',
        'measure',
        'start',
        'sum',
        'total',
        ({end, forwards, measure, start, sum, total}, cbk) =>
      {
        const since = `from ${start.calendar().toLowerCase()}`;
        const to = !!end ? ` to ${end.calendar().toLowerCase()}` : '';

        if (!!args.is_count) {
          const duration = `Forwarded in ${sum.count.length} ${measure}s`;
          const forwarded = `Total: ${forwards.length} forwards`;

          return cbk(null, `${duration} ${since}${to}. ${forwarded}`);
        } else if (!!args.is_forwarded) {
          const duration = `Forwarded in ${sum.count.length} ${measure}s`;

          return cbk(null, `${duration} ${since}${to}. Total: ${total}`);
        } else {
          const duration = `Earned in ${sum.fees.length} ${measure}s`;

          return cbk(null, `${duration} ${since}${to}. Total: ${total}`);
        }
      }],

      // Heading
      head: ['getRates', ({getRates}, cbk) => {
        if (!!args.is_count) {
          return cbk(null, 'Forwards count');
        }

        // Fiat amounts are labeled with their fiat
        const fiat = !!getRates ? ` (${getRates.fiat})` : '';

        if (!!args.is_forwarded) {
          return cbk(null, `Forwarded amount${fiat}`);
        }

        return cbk(null, `Routing fees earned${fiat}`);
      }],

      // Summary title of the fees earned
      title: ['getNode', 'head', 'viaTag', ({getNode, head, viaTag}, cbk) => {
        // Exit early when no via is specified
        if (!args.via) {
          return cbk(null, head);
        }

        const via = viaTag || getNode;

        return cbk(null, `${head} via ${via.alias || via.id}`);
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
