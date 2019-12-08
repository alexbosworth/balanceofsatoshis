const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {getChannel} = require('ln-service');
const {getChannels} = require('ln-service');
const {getNode} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const tokensAsMtokens = tokens => BigInt(tokens) * BigInt(1e3);

/** Get inbound path

  {
    destination: <Final Destination Public Key Hex String>
    lnd: <Authenticated gRPC LND API Object>
    through: <In Through Node with Public Key Hex String>
    tokens: <Tokens to Send Number>
  }

  @returns via cbk or Promise
  {
    path: [{
      [base_fee_mtokens]: <Base Fee Millitokens String>
      [channel]: <Standard Format Channel Id String>
      [channel_capacity]: <Channel Capacity Tokens Number>
      [cltv_delta]: <Channel CLTV Delta Number>
      [fee_rate]: <Proportional Fee Rate Number>
      public_key: <Destination Public Key Hex String>
    }]
  }
*/
module.exports = ({destination, lnd, through, tokens}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!destination) {
          return cbk([400, 'ExpectedDestinationToGetInboundPath']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndToGetInboundPath']);
        }

        if (!through) {
          return cbk([400, 'ExpectedInThroughPublicKeyHexString']);
        }

        if (tokens === undefined) {
          return cbk([400, 'ExpectedTokensToGetInboundPath']);
        }

        return cbk();
      },

      // Get channels to validate the inbound channel exists
      getChannels: ['validate', ({}, cbk) => getChannels({lnd}, cbk)],

      // Get local node info to check if this is a local inbound channel
      getInfo: ['validate', ({}, cbk) => getWalletInfo({lnd}, cbk)],

      // Get node
      getNode: ['validate', ({}, cbk) => {
        return getNode({lnd, public_key: destination}, cbk);
      }],

      // Local channels
      localChannels: ['getChannels', ({getChannels}, cbk) => {
        const localChannels = getChannels.channels.filter(n => {
          return n.partner_public_key === through && !!n.is_private;
        });

        return asyncMap(localChannels, (channel, cbk) => {
          return getChannel({lnd, id: channel.id}, cbk);
        },
        cbk);
      }],

      // Connecting path
      path: [
        'getChannels',
        'getInfo',
        'getNode',
        'localChannels',
        ({getChannels, getInfo, getNode, localChannels}, cbk) =>
      {
        const channels = [].concat(getNode.channels).concat(localChannels);

        const connectingChannels = channels.filter(chan => {
          // Channel has a policy that matches the key of the through key
          return !!chan.policies.find(n => n.public_key === through);
        });

        if (!connectingChannels.length) {
          return cbk([400, 'NoConnectingChannelToPayIn']);
        }

        const publicKey = getInfo.public_key;

        const [channel] = connectingChannels.filter(chan => {
          const policy = chan.policies.find(n => n.public_key === through);

          if (!!chan.capacity && chan.capacity < tokens) {
            return false;
          }

          if (!policy.max_htlc_mtokens) {
            return false;
          }

          const isLocal = chan.policies.find(n => n.public_key === publicKey);

          const localChannel = getChannels.channels.find(({id}) => {
            return id === chan.id;
          });

          // Exit early when this is a local channel but doesn't exist
          if (!!isLocal && !localChannel) {
            return false;
          }

          return BigInt(policy.max_htlc_mtokens) > tokensAsMtokens(tokens);
        });

        if (!channel) {
          return cbk([400, 'NoSufficientCapacityConnectingChannelToPayIn']);
        }

        const policy = channel.policies.find(n => n.public_key === through);

        const path = [
          {
            public_key: through,
          },
          {
            base_fee_mtokens: policy.base_fee_mtokens,
            channel: channel.id,
            channel_capacity: channel.capacity,
            cltv_delta: policy.cltv_delta,
            fee_rate: policy.fee_rate,
            public_key: destination,
          },
        ];

        return cbk(null, {path});
      }],
    },
    returnResult({reject, resolve, of: 'path'}, cbk));
  });
};
