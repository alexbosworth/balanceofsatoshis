const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {getNode} = require('ln-service');
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
const daysPerWeek = 7;
const flatten = arr => [].concat(...arr);
const {floor} = Math;
const heading = [['Node', 'Public Key', 'Fees Paid', 'Forwarded']];
const hoursPerDay = 24;
const {isArray} = Array;
const {keys} = Object;
const minChartDays = 4;
const maxChartDays = 90;
const mtokensAsBigUnit = n => (Number(n / BigInt(1e3)) / 1e8).toFixed(8);
const tokensAsBigUnit = tokens => (tokens / 1e8).toFixed(8);

/** Get routing fees paid

  {
    days: <Fees Earned Over Days Count Number>
    fs: {
      getFile: <Read File Contents Function> (path, cbk) => {}
    }
    [is_most_fees_table]: <Is Most Fees Table Bool>
    [is_most_forwarded_table]: <Is Most Forwarded Bool>
    [is_network]: <Show Only Non-Peers In Table Bool>
    [is_peer]: <Show Only Peers In Table Bool>
    lnds: [<Authenticated LND API Object>]
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

        if (!args.fs) {
          return cbk([400, 'ExpectedFsMethodsToGetRoutingFeesPaid']);
        }

        if (!!args.is_network && !!args.is_peer) {
          return cbk([400, 'ExpectedEitherNetworkOrPeersNotBoth']);
        }

        if (!isArray(args.lnds) || !args.lnds.length) {
          return cbk([400, 'ExpectedLndToGetFeesChart']);
        }

        return cbk();
      },

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

            return cbk(null, res.payments);
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
      forwards: ['getPayments', 'start', ({getPayments, start}, cbk) => {
        const payments = getPayments.filter(payment => {
          return payment.confirmed_at > start.toISOString();
        });

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

        const confirmed = arr => arr.filter(n => !!n.is_confirmed);

        const fees = forwards.reduce((sum, {attempts, paths}) => {
          const confirmedPaths = !!attempts ? confirmed(attempts) : paths;

          confirmedPaths.forEach(({hops, route}) => {
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

        const forwarded = forwards.reduce((sum, {attempts, paths}) => {
          const confirmedPaths = !!attempts ? confirmed(attempts) : paths;

          confirmedPaths.forEach(({hops, route}) => {
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

      // Total paid
      total: ['forwards', ({forwards}, cbk) => {
        const paid = forwards.reduce((sum, {fee}) => sum + fee, Number());

        return cbk(null, paid);
      }],

      // Payments activity aggregated
      sum: [
        'forwards',
        'measure',
        'segments',
        ({forwards, measure, segments}, cbk) =>
      {
        return cbk(null, feesForSegment({by, forwards, measure, segments}));
      }],

      // Summary description of the fees paid
      description: [
        'forwards',
        'measure',
        'start',
        'sum',
        'total',
        ({forwards, measure, start, sum, total}, cbk) =>
      {
        const duration = `Fees paid in ${sum.fees.length} ${measure}s`;
        const paid = tokensAsBigUnit(total);
        const since = `since ${start.calendar().toLowerCase()}`;

        return cbk(null, `${duration} ${since}. Total: ${paid}`);
      }],

      // Fees paid
      data: ['description', 'rows', 'sum', ({description, rows, sum}, cbk) => {
        const data = sum.fees;
        const title = 'Routing fees paid';

        return cbk(null, {data, description, rows, title});
      }],
    },
    returnResult({reject, resolve, of: 'data'}, cbk));
  });
};
