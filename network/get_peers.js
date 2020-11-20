const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const asyncUntil = require('async/until');
const {bold} = require('colorette');
const {decodeChanId} = require('bolt07');
const {formatTokens} = require('ln-sync');
const {getChannel} = require('ln-service');
const {getChannels} = require('ln-service');
const {getClosedChannels} = require('ln-service');
const {getHeight} = require('ln-service');
const {getInvoices} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {getNode} = require('ln-service');
const {getPayments} = require('ln-service');
const {getPeers} = require('ln-service');
const {getPendingChannels} = require('ln-service');
const moment = require('moment');
const {returnResult} = require('asyncjs-util');
const size = require('window-size');

const {authenticatedLnd} = require('./../lnd');
const {chartAliasForPeer} = require('./../display');
const {formatFeeRate} = require('./../display');
const {getPastForwards} = require('./../routing');
const {sortBy} = require('./../arrays');

const defaultInvoicesLimit = 100;
const defaultSort = 'first_connected';
const fromNow = epoch => !epoch ? undefined : moment(epoch * 1e3).fromNow();
const {isArray} = Array;
const {max} = Math;
const minutesPerBlock = network => network === 'ltcmainnet' ? 10 / 4 : 10;
const notNull = array => array.filter(n => n !== null);
const notFoundIndex = -1;
const {round} = Math;
const sumOf = arr => arr.reduce((sum, n) => sum + n, Number());
const uniq = arr => Array.from(new Set(arr));
const wideSizeCols = 150;

/** Get channel-connected peers

  {
    [earnings_days]: <Routing Fee Earnings Days Number>
    [idle_days]: <Not Active For Days Number>
    [inbound_liquidity_below]: <Inbound Liquidity Below Tokens Number>
    [is_active]: <Active Channels Only Bool>
    [is_monochrome]: <Mute Colors Bool>
    [is_offline]: <Offline Channels Only Bool>
    [is_private]: <Private Channels Only Bool>
    [is_public]: <Public Channels Only Bool>
    [is_table]: <Peers As Table Bool>
    lnd: <Authenticated LND gRPC API Object>
    omit: [<Omit Peer With Public Key Hex String>]
    [outbound_liquidity_below]: <Outbound Liquidity Below Tokens Number>
    [sort_by]: <Sort Results By Attribute String>
  }

  @returns via cbk or Promise
  {
    peers: [{
      alias: <Node Alias String>
      [fee_earnings]: <Fees Earned Via Peer Tokens Number>
      first_connected: <Oldest Channel With Peer String>
      [last_activity]: <Last Activity String>
      inbound_fee_rate: <Inbound Fee Rate String>
      inbound_liquidity: <Inbound Liquidity Amount Number>
      outbound_liquidity: <Outbound Liquidity Amount Number>
      public_key: <Public Key Hex String>
    }]
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToGetPeers']);
        }

        if (!isArray(args.omit)) {
          return cbk([400, 'ExpectedOmitArrayToGetPeers']);
        }

        if (!!isArray(args.sort_by)) {
          return cbk([400, 'SortingByMultipleFieldsNotSupported']);
        }

        return cbk();
      },

      // Get channels
      getChannels: ['validate', async ({}) => {
        return await getChannels({
          is_active: args.is_active,
          is_offline: args.is_offline,
          is_private: args.is_private,
          is_public: args.is_public,
          lnd: args.lnd,
        });
      }],

      // Get closed channels
      getClosed: ['validate', async ({}) => {
        return await getClosedChannels({lnd: args.lnd});
      }],

      // Get fee earnings
      getForwards: ['validate', ({}, cbk) => {
        const dayFilters = [args.earnings_days, args.idle_days];

        // Exit early when there are no days to get forwards over
        if (!dayFilters.filter(n => !!n).length) {
          return cbk(null, {forwards: []});
        }

        const days = max(...dayFilters.filter(n => !!n));

        return getPastForwards({days, lnd: args.lnd}, cbk);
      }],

      // Get invoices
      getInvoices: ['validate', ({}, cbk) => {
        const invoices = [];
        let token;

        if (args.idle_days === undefined) {
          return cbk(null, invoices);
        }

        return asyncUntil(
          cbk => cbk(null, token === false),
          cbk => {
            return getInvoices({
              token,
              limit: !token ? defaultInvoicesLimit : undefined,
              lnd: args.lnd,
            },
            (err, res) => {
              if (!!err) {
                return cbk(err);
              }

              token = res.next || false;

              res.invoices.forEach(n => invoices.push(n));

              return cbk();
            });
          },
          err => {
            if (!!err) {
              return cbk(err);
            }

            return cbk(null, invoices.filter(n => !!n.is_confirmed));
          }
        );
      }],

      // Get payments
      getPayments: ['validate', ({}, cbk) => {
        // Exit early and skip long payments lookup when idle days not needed
        if (args.idle_days === undefined) {
          return cbk(null, {payments: []})
        }

        return getPayments({lnd: args.lnd}, cbk);
      }],

      // Get connected peers
      getPeers: ['validate', ({}, cbk) => getPeers({lnd: args.lnd}, cbk)],

      // Get pending channels
      getPending: ['validate', ({}, cbk) => {
        return getPendingChannels({lnd: args.lnd}, cbk);
      }],

      // Get policies
      getPolicies: ['getChannels', ({getChannels}, cbk) => {
        return asyncMap(getChannels.channels, ({id}, cbk) => {
          return getChannel({id, lnd: args.lnd}, (err, res) => {
            const [errorCode] = err || [];

            if (errorCode === 404) {
              return cbk();
            }

            return cbk(null, {policies: res.policies});
          });
        },
        cbk);
      }],

      // All channels
      allChannels: [
        'getChannels',
        'getClosed',
        ({getChannels, getClosed}, cbk) =>
      {
        const closedChannels = getClosed.channels
          .filter(({id}) => !!id)
          .map(n => ({id: n.id, key: n.partner_public_key}));

        const openChannels = getChannels.channels.map(channel => {
          return {id: channel.id, key: channel.partner_public_key};
        });

        return cbk(null, [].concat(closedChannels).concat(openChannels));
      }],

      // Forwards
      forwards: [
        'allChannels',
        'getForwards',
        ({allChannels, getForwards}, cbk) =>
      {
        const channels = allChannels;

        const forwards = getForwards.forwards.map(forward => {
          const inKey = channels.find(n => n.id === forward.incoming_channel);
          const outKey = channels.find(n => n.id === forward.outgoing_channel);

          return {
            created_at: forward.created_at,
            fee: forward.fee,
            inbound: !!inKey ? inKey.key : null,
            outbound: !!outKey ? outKey.key : null,
          };
        });

        return cbk(null, forwards);
      }],

      // Peers
      peers: [
        'allChannels',
        'forwards',
        'getChannels',
        'getInvoices',
        'getPayments',
        'getPeers',
        'getPending',
        'getPolicies',
        async ({
          allChannels,
          forwards,
          getChannels,
          getInvoices,
          getPayments,
          getPeers,
          getPending,
          getPolicies,
        }) =>
      {
        const lastForwardedPayment = forwards.reduce((sum, forward) => {
          [forward.inbound, forward.outbound]
            .filter(n => !!n)
            .forEach(publicKey => {
              const last = sum[publicKey];

              // Exit early when the last forward is later than this forward
              if (!!last && last > forward.created_at) {
                return;
              }

              return sum[publicKey] = forward.created_at;
            });

          return sum;
        },
        {});

        const lastPaidOut = getPayments.payments.reduce((sum, n) => {
          const [through] = n.hops;

          if (!!through && (!sum[through] || sum[through] < n.created_at)) {
            sum[through] = n.created_at;
          }

          return sum;
        },
        {});

        const lastReceivedPayment = getInvoices.reduce((sum, n) => {
          n.payments.forEach(payment => {
            const {channels} = getChannels;

            const channel = channels.find(n => n.id === payment.in_channel);

            if (!channel) {
              return;
            }

            const last = sum[channel.partner_public_key];

            // Exit early when the last payment is later than this payment
            if (!!last && last > payment.confirmed_at) {
              return;
            }

            return sum[channel.partner_public_key] = payment.confirmed_at;
          });

          return sum;
        },
        {});

        const maxInbound = args.inbound_liquidity_below;
        const maxOutbound = args.outbound_liquidity_below;
        const {network} = await getNetwork({lnd: args.lnd});
        const peerKeys = getChannels.channels.map(n => n.partner_public_key);
        const wallet = await getHeight({lnd: args.lnd});

        const heights = allChannels.map(({id, key}) => {
          return {key, height: decodeChanId({channel: id}).block_height};
        });

        const mpb = minutesPerBlock(network);

        const peers = await asyncMap(uniq(peerKeys), async publicKey => {
          const forwarded = lastForwardedPayment[publicKey];
          const gotLast = lastReceivedPayment[publicKey];
          const peer = getPeers.peers.find(n => n.public_key === publicKey);
          const lastPaidThrough = lastPaidOut[publicKey];

          const feeEarnings = forwards.filter(fwd => {
            return fwd.inbound === publicKey || fwd.outbound === publicKey;
          });

          const channelHeights = sortBy({
            array: heights.filter(({key}) => key === publicKey),
            attribute: 'height',
          });

          const [newest] = channelHeights.sorted.slice().reverse();
          const [oldest] = channelHeights.sorted;

          const blocks = wallet.current_block_height - oldest.height;
          const newBlocks = wallet.current_block_height - newest.height;

          const activeChannels = getChannels.channels.filter(channel => {
            return channel.partner_public_key === publicKey;
          });

          // A thaw channel cannot be cooperatively closed until a block height
          const hasThawChannel = activeChannels
            .map(n => n.cooperative_close_delay_height)
            .filter(n => !!n)
            .find(n => n > wallet.current_block_height);

          const hasHtlcChannel = activeChannels
            .map(n => n.pending_payments.length)
            .filter(n => !!n)
            .find(n => !!n.id);

          const isPrivatePeer = !activeChannels.find(n => !n.is_private);

          const uptime = sumOf(activeChannels
            .filter(n => !!n.time_online)
            .map(n => n.time_online));

          const downtime = sumOf(activeChannels
            .filter(n => !!n.time_offline)
            .map(n => n.time_offline));

          const pendingChannels = getPending.pending_channels.filter(chan => {
            return !!chan.is_opening && chan.partner_public_key === publicKey;
          });

          const channels = [].concat(activeChannels).concat(pendingChannels);

          const policies = getPolicies
            .filter(n => !!n)
            .map(n => n.policies.find(n => n.public_key === publicKey))
            .filter(n => !!n);

          const feeRates = policies
            .map(n => n.fee_rate)
            .filter(n => n !== undefined);

          const feeRate = !feeRates.length ? undefined : max(...feeRates);

          let node = {alias: String(), public_key: publicKey};

          try {
            node = await getNode({
              is_omitting_channels: true,
              lnd: args.lnd,
              public_key: publicKey,
            });
          } catch (err) {}

          const lastActivity = max(...[
            moment().subtract(blocks * mpb, 'minutes').unix(),
            moment().subtract(newBlocks * mpb, 'minutes').unix(),
            !gotLast ? Number() : moment(gotLast).unix(),
            !forwarded ? Number() : moment(forwarded).unix(),
            !lastPaidThrough ? Number() : moment(lastPaidThrough).unix(),
          ].filter(n => !!n));

          return {
            alias: node.alias,
            downtime_percentage: round(100 * (downtime / (downtime + uptime))),
            fee_earnings: sumOf(feeEarnings.map(n => n.fee)),
            first_connected: moment().subtract(blocks * mpb, 'minutes').unix(),
            inbound_fee_rate: feeRate,
            inbound_liquidity: sumOf(channels.map(n => n.remote_balance)),
            is_forwarding: hasHtlcChannel || undefined,
            is_offline: !peer || undefined,
            is_private: isPrivatePeer || undefined,
            is_thawing: hasThawChannel || undefined,
            last_activity: args.idle_days !== undefined ? lastActivity : null,
            outbound_liquidity: sumOf(channels.map(n => n.local_balance)),
            public_key: publicKey,
          };
        });

        return {
          peers: sortBy({array: peers, attribute: args.sort_by || defaultSort})
            .sorted
            .filter(n => !maxInbound || n.inbound_liquidity < maxInbound)
            .filter(n => !maxOutbound || n.outbound_liquidity < maxOutbound)
            .filter(n => args.omit.indexOf(n.public_key) === notFoundIndex)
            .filter(n => {
              // Always return peer when no idle days are specified
              if (!args.idle_days) {
                return true;
              }

              const hasPendingChan = getPending.pending_channels.find(chan => {
                return chan.partner_public_key === n.public_key;
              });

              if (!!hasPendingChan) {
                return false;
              }

              const after = moment().subtract(args.idle_days, 'days').unix();

              if (n.last_activity > after) {
                return false;
              }

              return true;
            })
            .map(peer => {
              const rate = peer.inbound_fee_rate;

              return {
                alias: peer.alias,
                downtime_percentage: peer.downtime_percentage,
                fee_earnings: peer.fee_earnings,
                first_connected: fromNow(peer.first_connected),
                last_activity: fromNow(peer.last_activity),
                inbound_fee_rate: formatFeeRate({rate}).display,
                inbound_liquidity: peer.inbound_liquidity,
                is_forwarding: peer.is_forwarding,
                is_offline: peer.is_offline,
                is_private: peer.is_private,
                is_thawing: peer.is_thawing,
                outbound_liquidity: peer.outbound_liquidity,
                public_key: peer.public_key,
              };
            }),
        };
      }],

      // Final peers and table
      allPeers: ['peers', ({peers}, cbk) => {
        if (!args.is_table) {
          return cbk(null, {
            peers: peers.peers.map(n => ({
              alias: n.alias,
              fee_earnings: n.fee_earnings || undefined,
              downtime_percentage: n.downtime_percentage || undefined,
              first_connected: n.first_connected || undefined,
              last_activity: n.last_activity || undefined,
              inbound_fee_rate: n.inbound_fee_rate || undefined,
              inbound_liquidity: n.inbound_liquidity || undefined,
              is_forwarding: n.is_forwarding || undefined,
              is_offline: n.is_offline || undefined,
              is_private: n.is_private || undefined,
              is_thawing: n.is_thawing || undefined,
              outbound_liquidity: n.outbound_liquidity || undefined,
              public_key: n.public_key || undefined,
            })),
          });
        }

        const isWideSize = !size || size.get().width > wideSizeCols;

        return cbk(null, {
          peers: peers.peers,
          rows: []
            .concat([notNull([
              'Alias',
              'Inbound',
              'In Fee',
              'Outbound',
              !!args.earnings_days ? 'Earned' : null,
              !!isWideSize ? 'Public Key' : null,
            ]).map(n => !args.is_monochrome ? bold(n) : n)])
            .concat(peers.peers.map(peer => {
              const earnings = formatTokens({
                is_monochrome: args.is_monochrome,
                tokens: peer.fee_earnings,
              });

              const inbound = formatTokens({
                is_monochrome: args.is_monochrome,
                tokens: peer.inbound_liquidity,
              });

              const outbound = formatTokens({
                is_monochrome: args.is_monochrome,
                tokens: peer.outbound_liquidity,
              });

              const alias = chartAliasForPeer({
                alias: peer.alias,
                downtime_percentage: peer.downtime_percentage,
                is_forwarding: peer.is_forwarding,
                is_inactive: peer.is_offline,
                is_private: peer.is_private,
                is_thawing: peer.is_thawing,
                public_key: peer.public_key,
              });

              return notNull([
                alias.display,
                inbound.display || ' ',
                peer.inbound_fee_rate || ' ',
                outbound.display || ' ',
                !!args.earnings_days ? earnings.display : null,
                !!isWideSize ? peer.public_key : null,
              ]);
            })),
        });
      }],
    },
    returnResult({reject, resolve, of: 'allPeers'}, cbk));
  });
};
