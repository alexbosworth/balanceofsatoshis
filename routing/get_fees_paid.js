const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {findKey} = require('ln-sync');
const {getNode} = require('ln-service');
const {getNodeAlias} = require('ln-sync');
const {getChannels} = require('ln-service');
const {getPayments} = require('ln-sync');
const {getRebalancePayments} = require('ln-sync');
const moment = require('moment');
const {returnResult} = require('asyncjs-util');

const {chartAliasForPeer} = require('./../display');
const feesForSegment = require('./fees_for_segment');
const {getIcons} = require('./../display');
const {sortBy} = require('./../arrays');

const by = 'confirmed_at';
const daysBetween = (a, b) => moment(a).diff(b, 'days') + 1;
const daysPerWeek = 7;
const defaultDays = 60;
const flatten = arr => [].concat(...arr);
const {floor} = Math;
const heading = [['Node', 'Public Key', 'Fees Paid', 'Forwarded']];
const hoursCount = (a, b) => moment(a).diff(b, 'hours') + 1;
const hoursPerDay = 24;
const isAmbiguous = n => n[1] === 'AmbiguousAliasSpecified';
const {isArray} = Array;
const isDate = n => /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.test(n);
const {keys} = Object;
const minChartDays = 4;
const maxChartDays = 90;
const mtokensAsBigUnit = n => (Number(n / BigInt(1e3)) / 1e8).toFixed(8);
const mtokensAsTokens = mtokens => Number(mtokens / BigInt(1e3));
const niceAlias = n => `${(n.alias || n.id).trim()} ${n.id.substring(0, 8)}`;
const {now} = Date;
const parseDate = n => Date.parse(n);
const title = 'Routing fees paid';
const tokensAsBigUnit = tokens => (tokens / 1e8).toFixed(8);
const uniq = arr => Array.from(new Set(arr));

/** Get routing fees paid

  {
    [days]: <Fees Earned Over Days Count Number>
    [end_date]: <End Date YYYY-MM-DD String>
    fs: {
      getFile: <Read File Contents Function> (path, cbk) => {}
    }
    [in]: <In Node Public Key or Alias String>
    [is_most_fees_table]: <Is Most Fees Table Bool>
    [is_most_forwarded_table]: <Is Most Forwarded Bool>
    [is_network]: <Show Only Non-Peers In Table Bool>
    [is_peer]: <Show Only Peers In Table Bool>
    lnds: [<Authenticated LND API Object>]
    [out]: <Out Node Public Key or Alias String>
    [start_date]: <Start Date YYYY-MM-DD String>
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
        if (!args.fs) {
          return cbk([400, 'ExpectedFsMethodsToGetRoutingFeesPaid']);
        }

        if (!!args.is_network && !!args.is_peer) {
          return cbk([400, 'ExpectedEitherNetworkOrPeersNotBoth']);
        }

        if (!isArray(args.lnds) || !args.lnds.length) {
          return cbk([400, 'ExpectedLndToGetRoutingFeesPaid']);
        }

        // Exit early when there is no end date and no start date
        if (!args.end_date && !args.start_date) {
          return cbk();
        }

        if (!!args.days) {
          return cbk([400, 'ExpectedEitherDaysOrDatesToGetRoutingFeesPaid']);
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
          return cbk([400, 'ExpectedPastStartDateToGetRoutingFeesPaid']);
        }

        // Exit early when there is no end date
        if (!args.end_date) {
          return cbk();
        }

        if (args.start_date >= args.end_date) {
          return cbk([400, 'ExpectedStartDateBeforeEndDateForFeesChart']);
        }

        if (!isDate(args.end_date)) {
          return cbk([400, 'ExpectedValidDateFormatForFeesChartEndDate']);
        }

        if (!moment(args.end_date).isValid()) {
          return cbk([400, 'ExpectedValidEndDateForFeesChartEndDate']);
        }

        if (parseDate(args.end_date) > now()) {
          return cbk([400, 'ExpectedPastEndDateToGetRoutingFeesPaid']);
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

      // Get channels
      getChannels: ['validate', ({}, cbk) => {
        return asyncMap(args.lnds, (lnd, cbk) => {
          return getChannels({lnd}, cbk);
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          return cbk(null, flatten(res.map(n => n.channels)));
        });
      }],

      // Get node icons
      getIcons: ['validate', ({}, cbk) => getIcons({fs: args.fs}, cbk)],

      // Determine the in public key to use
      getInKey: ['validate', ({}, cbk) => {
        // Exit early when no in query is specified
        if (!args.in) {
          return cbk();
        }

        return asyncMap(args.lnds, (lnd, cbk) => {
          return findKey({lnd, query: args.in}, (err, res) => {
            // Exit for ambiguous queries
            if (!!err && isAmbiguous(err)) {
              return cbk(err);
            }

            // Ignore all other errors, since a peer may not exist on all nodes
            if (!!err) {
              return cbk();
            }

            return cbk(null, res.public_key);
          });
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          const [key, otherKey] = uniq(res.filter(n => !!n));

          if (!key) {
            return cbk([400, 'FailedToFindMatchesForInQueryAlias']);
          }

          if (!!otherKey) {
            return cbk([400, 'MultipleMatchesForInQueryAlias']);
          }

          return cbk(null, key);
        });
      }],

      // Determine the out public key to use
      getOutKey: ['validate', ({}, cbk) => {
        // Exit early when no out query is specified
        if (!args.out) {
          return cbk();
        }

        return asyncMap(args.lnds, (lnd, cbk) => {
          return findKey({lnd, query: args.out}, (err, res) => {
            // Exit for ambiguous queries
            if (!!err && isAmbiguous(err)) {
              return cbk(err);
            }

            // Ignore all other errors, since a peer may not exist on all nodes
            if (!!err) {
              return cbk();
            }

            return cbk(null, res.public_key);
          });
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          const [key, otherKey] = uniq(res.filter(n => !!n));

          if (!key) {
            return cbk([400, 'FailedToFindMatchesForOutQueryAlias']);
          }

          if (!!otherKey) {
            return cbk([400, 'MultipleMatchesForOutQueryAlias']);
          }

          return cbk(null, key);
        });
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

      // Get payments
      getPayments: ['start', 'validate', ({start}, cbk) => {
        // Exit early when only considering rebalance payments
        if (!!args.is_rebalances_only) {
          return getRebalancePayments({
            after: start.toISOString(),
            lnds: args.lnds,
          },
          (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            return cbk(null, res.payments.map(payment => ({
              attempts: payment.paths.map(route => ({route})),
              confirmed_at: payment.confirmed_at,
              created_at: payment.created_at,
              is_confirmed: payment.is_confirmed,
            })));
          });
        }

        return asyncMap(args.lnds, (lnd, cbk) => {
          return getPayments({after: start.toISOString(), lnd}, cbk);
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          return cbk(null, flatten(res.map(n => n.payments)));
        });
      }],

      // Filter the payments
      forwards: [
        'end',
        'getInKey',
        'getOutKey',
        'getPayments',
        'start',
        ({end, getInKey, getOutKey, getPayments, start}, cbk) =>
      {
        const payments = getPayments
          .filter(payment => payment.is_confirmed !== false)
          .filter(payment => payment.confirmed_at > start.toISOString())
          .filter(payment => !!args.end_date ? (payment.confirmed_at <= end.toISOString()) : payment)
          .map(payment => {
            const attempts = payment.attempts.filter(attempt => {
              // Only consider attempts that confirmed
              if (attempt.is_confirmed === false) {
                return false;
              }

              const keys = attempt.route.hops.map(n => n.public_key);

              const [outHop] = keys;

              const [, inHop] = keys.slice().reverse();

              if (!outHop) {
                return false;
              }

              // Ignore attempts that do not include the specified out hop
              if (!!args.out && outHop !== getOutKey) {
                return false;
              }

              if (!!args.in && !inHop) {
                return false;
              }

              // Ignore attempts that do not include the specified in hop
              if (!!args.in && inHop !== getInKey) {
                return false;
              }

              return true;
            });

            if (!attempts.length) {
              return;
            }

            const totalFees = attempts.reduce((sum, attempt) => {
              return sum + BigInt(attempt.route.fee_mtokens);
            },
            BigInt(Number()));

            const totalTokens = attempts.reduce((sum, attempt) => {
              return sum + BigInt(attempt.route.mtokens);
            },
            BigInt(Number()));

            return {
              attempts,
              confirmed_at: payment.confirmed_at,
              created_at: payment.created_at,
              fee: mtokensAsTokens(totalFees),
              fee_mtokens: totalFees.toString(),
              mtokens: totalTokens.toString(),
            };
          })
          .filter(n => !!n);

        return cbk(null, payments);
      }],

      // Fees paid to specific forwarding peers
      rows: [
        'forwards',
        'getChannels',
        'getIcons',
        ({forwards, getChannels, getIcons}, cbk) =>
      {
        if (!args.is_most_forwarded_table && !args.is_most_fees_table) {
          return cbk();
        }

        const fees = forwards.reduce((sum, {attempts}) => {
          attempts.forEach(({hops, route}) => {
            const usedHops = !!route ? route.hops : hops;

            return usedHops.slice().reverse().forEach((hop, i) => {
              if (!i) {
                return;
              }

              const key = hop.public_key;

              const current = sum[key] || BigInt(Number());

              sum[key] = current + BigInt(hop.fee_mtokens);

              return;
            });
          });

          return sum;
        },
        {});

        const forwarded = forwards.reduce((sum, {attempts}) => {
          attempts.forEach(({hops, route}) => {
            const usedHops = !!route ? route.hops : hops;

            return usedHops.slice().reverse().forEach((hop, i) => {
              if (!i) {
                return;
              }

              const key = hop.public_key;

              const current = sum[key] || BigInt(Number());

              sum[key] = current + BigInt(hop.forward_mtokens);

              return;
            });
          });

          return sum;
        },
        {});

        return asyncMap(keys(fees), (key, cbk) => {
          const [lnd] = args.lnds;

          return getNode({
            lnd,
            is_omitting_channels: true,
            public_key: key,
          },
          (err, res) => {
            return cbk(null, {
              alias: (res || {}).alias,
              fees_paid: fees[key],
              forwarded: forwarded[key] || BigInt(Number()),
              public_key: key,
            });
          });
        },
        (err, array) => {
          if (!!err) {
            return cbk(err);
          }

          const sort = !!args.is_most_fees_table ? 'fees_paid' : 'forwarded';

          const peerKeys = getChannels.map(n => n.partner_public_key);

          const rows = sortBy({array, attribute: sort}).sorted
            .filter(n => {
              // Exit early when there is no peer/network filter
              if (!args.is_network && !args.is_peer) {
                return true;
              }

              const isPeer = !!peerKeys.find(key => key === n.public_key);

              return !!args.is_peer ? isPeer : !isPeer;
            })
            .map(node => {
              const key = node.public_key;

              const nodeIcons = getIcons.nodes.find(n => n.public_key === key);

              const {display} = chartAliasForPeer({
                alias: node.alias || ' ',
                icons: !!nodeIcons ? nodeIcons.icons : undefined,
                public_key: key,
              });

              return [
                display,
                key,
                mtokensAsBigUnit(node.fees_paid),
                mtokensAsBigUnit(node.forwarded),
              ];
            });

          return cbk(null, [].concat(heading).concat(rows));
        });
      }],

      // Total number of segments
      segments: ['days', 'measure', ({days, measure}, cbk) => {
        switch (measure) {
        case 'hour':
          // Exit early when using full days
          if (!args.start_date) {
            return cbk(null, hoursPerDay * days);
          }

          return cbk(null, hoursCount(moment(args.end_date), args.start_date));

        case 'week':
          return cbk(null, floor(days / daysPerWeek));

        default:
          return cbk(null, days);
        }
      }],

      // Total paid
      total: ['forwards', ({forwards}, cbk) => {
        const paid = forwards.reduce((sum, payment) => {
          return sum + BigInt(payment.fee_mtokens);
        },
        BigInt(Number()));

        return cbk(null, mtokensAsTokens(paid));
      }],

      // Payments activity aggregated
      sum: [
        'forwards',
        'measure',
        'segments',
        ({forwards, measure, segments}, cbk) =>
      {
        return cbk(null, feesForSegment({by, forwards, measure, segments, end: args.end_date}));
      }],

      // Summary description of the fees paid
      description: [
        'end',
        'forwards',
        'measure',
        'start',
        'sum',
        'total',
        ({end, forwards, measure, start, sum, total}, cbk) =>
      {
        const duration = `Fees paid in ${sum.fees.length} ${measure}s`;
        const paid = tokensAsBigUnit(total);
        const since = `since ${start.calendar().toLowerCase()}`;
        const to = !!end ? ` to ${end.calendar().toLowerCase()}` : '';

        return cbk(null, `${duration} ${since}${to}. Total: ${paid}`);
      }],

      // Title for fees paid
      title: [
        'validate',
        'getInKey',
        'getOutKey',
        async ({getInKey, getOutKey}) =>
      {
        const [lnd] = args.lnds;

        const into = !args.in ? {} : await getNodeAlias({lnd, id: getInKey});
        const out = !args.out ? {} : await getNodeAlias({lnd, id: getOutKey});

        const inPeer = !!args.in ? `in ${niceAlias(into)}` : '';
        const outPeer = !!args.out ? `out ${niceAlias(out)}` : '';

        return [title, outPeer, inPeer].filter(n => !!n).join(' ');
      }],

      // Fees paid
      data: [
        'description',
        'rows',
        'sum',
        'title',
        ({description, rows, sum, title}, cbk) =>
      {
        const isRows = args.is_most_fees_table || args.is_most_forwarded_table;

        // Add a title row when there is a restriction involved
        if (!!isRows && (!!args.in || !!args.out)) {
          rows.unshift([String(), title, String(), String()]);
        }

        return cbk(null, {description, rows, title, data: sum.fees});
      }],
    },
    returnResult({reject, resolve, of: 'data'}, cbk));
  });
};
