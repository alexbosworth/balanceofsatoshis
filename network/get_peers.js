const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {getChannel} = require('ln-service');
const {getChannels} = require('ln-service');
const {getNode} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const {authenticatedLnd} = require('./../lnd');
const {sortBy} = require('./../arrays');

const asRate = rate => !!rate ? (rate / 1e4).toFixed(2) + '%' : undefined;
const defaultSort = 'public_key';
const {max} = Math;
const sumOf = arr => arr.reduce((sum, n) => sum + n);
const uniq = arr => Array.from(new Set(arr));

/** Get channel-connected peers

  {
    [inbound_liquidity_below]: <Inbound Liquidity Below Tokens Number>
    [is_active]: <Active Channels Only Bool>
    [is_offline]: <Offline Channels Only Bool>
    [is_public]: <Public Channels Only Bool>
    lnd: <Authenticated LND gRPC API Object>
    [outbound_liquidity_below]: <Outbound Liquidity Below Tokens Number>
    [sort_by]: <Sort Results By Attribute String>
  }

  @returns via cbk or Promise
  {
    peers: [{
      alias: <Node Alias String>
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
          is_public: args.is_public,
          lnd: args.lnd,
        });
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

      // Peers
      peers: [
        'getChannels',
        'getPolicies',
        async ({getChannels, getPolicies}) =>
      {
        const maxInbound = args.inbound_liquidity_below;
        const maxOutbound = args.outbound_liquidity_below;
        const peerKeys = getChannels.channels.map(n => n.partner_public_key);

        const peers = await asyncMap(uniq(peerKeys), async publicKey => {
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
