const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {getChannel} = require('ln-service');
const {getChannels} = require('ln-service');
const {getNode} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const {authenticatedLnd} = require('./../lnd');
const {sortBy} = require('./../arrays');

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
    [node]: <Node Name String>
    [outbound_liquidity_below]: <Outbound Liquidity Below Tokens Number>
    [sort_by]: <Sort Results By Attribute String>
  }

  @returns via cbk or Promise
  {
    peers: [{
      alias: <Node Alias String>
      inbound_liquidity: <Inbound Liquidity Amount String>
      outbound_liquidity: <Outbound Liquidity Amount String>
      public_key: <Public Key Hex String>
    }]
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Get lnd connection
      getLnd: async () => await authenticatedLnd({node: args.node}),

      // Get channels
      getChannels: ['getLnd', async ({getLnd}) => {
        return await getChannels({
          is_active: args.is_active,
          is_offline: args.is_offline,
          is_public: args.is_public,
          lnd: getLnd.lnd,
        });
      }],

      // Get policies
      getPolicies: ['getChannels', 'getLnd', ({getChannels, getLnd}, cbk) => {
        return asyncMap(getChannels.channels, ({id}, cbk) => {
          return getChannel({id, lnd: getLnd.lnd}, (err, res) => {
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
        'getLnd',
        'getPolicies', async ({getChannels, getLnd, getPolicies}) =>
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

          const feeRate = max(...policies.map(n => n.fee_rate));

          const node = await getNode({
            is_omitting_channels: true,
            lnd: getLnd.lnd,
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

        return sortBy({array: peers, attribute: args.sort_by || defaultSort})
          .sorted
          .filter(n => !maxInbound || n.inbound_liquidity < maxInbound)
          .filter(n => !maxOutbound || n.outbound_liquidity < maxOutbound)
          .map(n => ({
            alias: n.alias,
            inbound_fee_rate: (n.inbound_fee_rate / 1e4).toFixed(2) + '%',
            inbound_liquidity: (n.inbound_liquidity / 1e8).toFixed(8),
            outbound_liquidity: (n.outbound_liquidity / 1e8).toFixed(8),
            public_key: n.public_key,
          }));
      }],
    },
    returnResult({reject, resolve, of: 'peers'}, cbk));
  });
};
