const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {decodeChanId} = require('bolt07');
const {getChannel} = require('ln-service');
const {getChannels} = require('ln-service');
const {getClosedChannels} = require('ln-service');
const {getNode} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const moment = require('moment');
const {returnResult} = require('asyncjs-util');

const {authenticatedLnd} = require('./../lnd');
const getNetwork = require('./get_network');
const {getPastForwards} = require('./../routing');
const {sortBy} = require('./../arrays');

const asEarnings = (on, tok) => !!on ? (tok / 1e8).toFixed(8) : undefined;
const asRate = n => n !== undefined ? (n / 1e4).toFixed(2) + '%' : undefined;
const defaultSort = 'first_connected';
const {max} = Math;
const minutesPerBlock = network => network === 'ltcmainnet' ? 10 / 4 : 10;
const sumOf = arr => arr.reduce((sum, n) => sum + n);
const uniq = arr => Array.from(new Set(arr));

/** Get channel-connected peers

  {
    [earnings_days]: <Routing Fee Earnings Days Number>
    [inbound_liquidity_below]: <Inbound Liquidity Below Tokens Number>
    [is_active]: <Active Channels Only Bool>
    [is_offline]: <Offline Channels Only Bool>
    [is_private]: <Private Channels Only Bool>
    [is_public]: <Public Channels Only Bool>
    lnd: <Authenticated LND gRPC API Object>
    [outbound_liquidity_below]: <Outbound Liquidity Below Tokens Number>
    [sort_by]: <Sort Results By Attribute String>
  }

  @returns via cbk or Promise
  {
    peers: [{
      alias: <Node Alias String>
      [fee_earnings]: <Fees Earned Via Peer String>
      first_connected: <Oldest Channel With Peer String>
      inbound_fee_rate: <Inbound Fee Rate String>
      inbound_liquidity: <Inbound Liquidity Amount String>
      outbound_liquidity: <Outbound Liquidity Amount String>
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
        return getPastForwards({days: args.earnings_days, lnd: args.lnd}, cbk);
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
        'getPolicies',
        async ({allChannels, forwards, getChannels, getPolicies}) =>
      {
        const maxInbound = args.inbound_liquidity_below;
        const maxOutbound = args.outbound_liquidity_below;
        const {network} = await getNetwork({lnd: args.lnd});
        const peerKeys = getChannels.channels.map(n => n.partner_public_key);
        const wallet = await getWalletInfo({lnd: args.lnd});

        const heights = allChannels.map(({id, key}) => {
          return {key, height: decodeChanId({channel: id}).block_height};
        });

        const mpb = minutesPerBlock(network);

        const peers = await asyncMap(uniq(peerKeys), async publicKey => {
          const feeEarnings = forwards.filter(fwd => {
            return fwd.inbound === publicKey || fwd.outbound === publicKey;
          });

          const channelHeights = sortBy({
            array: heights.filter(({key}) => key === publicKey),
            attribute: 'height',
          });

          const [oldest] = channelHeights.sorted;

          const blocks = wallet.current_block_height - oldest.height;

          const channels = getChannels.channels.filter(channel => {
            return channel.partner_public_key === publicKey;
          });

          const policies = getPolicies
            .filter(n => !!n)
            .map(n => n.policies.find(n => n.public_key === publicKey))
            .filter(n => !!n);

          const feeRates = policies.map(n => n.fee_rate);

          const feeRate = !feeRates.length ? undefined : max(...feeRates);

          const node = await getNode({
            is_omitting_channels: true,
            lnd: args.lnd,
            public_key: publicKey,
          });

          return {
            alias: node.alias,
            fee_earnings: feeEarnings.reduce((sum, {fee}) => sum + fee, 0),
            first_connected: moment().subtract(blocks * mpb, 'minutes').unix(),
            inbound_fee_rate: feeRate,
            inbound_liquidity: sumOf(channels.map(n => n.remote_balance)),
            outbound_liquidity: sumOf(channels.map(n => n.local_balance)),
            public_key: publicKey,
          };
        });

        return {
          peers: sortBy({array: peers, attribute: args.sort_by || defaultSort})
            .sorted
            .filter(n => !maxInbound || n.inbound_liquidity < maxInbound)
            .filter(n => !maxOutbound || n.outbound_liquidity < maxOutbound)
            .map(n => ({
              alias: n.alias,
              fee_earnings: asEarnings(args.earnings_days, n.fee_earnings),
              first_connected: moment(n.first_connected * 1000).fromNow(),
              inbound_fee_rate: asRate(n.inbound_fee_rate),
              inbound_liquidity: (n.inbound_liquidity / 1e8).toFixed(8),
              outbound_liquidity: (n.outbound_liquidity / 1e8).toFixed(8),
              public_key: n.public_key,
            })),
        };
      }],
    },
    returnResult({reject, resolve, of: 'peers'}, cbk));
  });
};
