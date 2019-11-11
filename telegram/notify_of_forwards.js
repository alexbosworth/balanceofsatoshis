const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {getChannel} = require('ln-service');
const {getNode} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const sendMessage = require('./send_message');

const {isArray} = Array;
const uniq = arr => Array.from(new Set(arr));

/** Notify Telegram of forwarded payments

  {
    forwards: [{
      fee: <Forward Fee Tokens Earned Number>
      incoming_channel: <Standard Format Incoming Channel Id String>
      outgoing_channel: <Standard Format Outgoing Channel Id String>
      tokens: <Forwarded Tokens Number>
    }]
    from: <From Node Name String>
    id: <Connected User Id Number>
    key: <Telegram API Key String>
    lnd: <Authenticated LND gRPC API Object>
    request: <Request Function>
  }
*/
module.exports = ({forwards, from, id, key, lnd, request}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isArray(forwards)) {
          return cbk([400, 'ExpectedForwardsArrayToNotifyOfForwards']);
        }

        if (!from) {
          return cbk([400, 'ExpectedFromNodeNameToNotifyOfForwards']);
        }

        if (!id) {
          return cbk([400, 'ExpectedConnectedUserIdToNotifyOfForwards']);
        }

        if (!key) {
          return cbk([400, 'ExpectedTelegramApiKeyToNotifyOfForwards']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndToNotifyOfForwards']);
        }

        if (!request) {
          return cbk([400, 'ExpectedRequestFunctionToNotifyOfForwards']);
        }

        return cbk();
      },

      // Get own key
      getInfo: ['validate', ({}, cbk) => {
        // There is no need to find own key when there are no forwards
        if (!forwards.length) {
          return cbk();
        }

        return getWalletInfo({lnd}, cbk);
      }],

      // Get channel details
      getChannels: ['getInfo', ({getInfo}, cbk) => {
        const channels = []
          .concat(forwards.map(n => n.incoming_channel))
          .concat(forwards.map(n => n.outgoing_channel));

        return asyncMap(uniq(channels), (id, cbk) => {
          const publicKey = getInfo.public_key;

          return getChannel({id, lnd}, (err, res) => {
            // Ignore errors
            if (!!err) {
              return cbk();
            }

            const policy = res.policies.find(n => n.public_key !== publicKey);

            return cbk(null, {id, key: policy.public_key});
          });
        },
        cbk);
      }],

      // Get nodes associated with channels
      getNodes: ['getChannels', ({getChannels}, cbk) => {
        return asyncMap(getChannels.filter(n => !!n), (channel, cbk) => {
          return getNode({
            lnd,
            is_omitting_channels: true,
            public_key: channel.key,
          },
          (err, res) => {
            // Ignore errors
            if (!!err) {
              return cbk();
            }

            return cbk(null, {alias: res.alias, key: channel.key});
          });
        },
        cbk);
      }],

      // Send message to Telegram
      notify: ['getChannels', 'getNodes', ({getChannels, getNodes}, cbk) => {
        if (!forwards.length) {
          return cbk();
        }

        const channels = getChannels.filter(n => !!n);
        const nodes = getNodes.filter(n => !!n);

        const details = forwards.map(forward => {
          const inboundChannel = channels
            .find(channel => channel.id === forward.incoming_channel) || {};

          const outboundChannel = channels
            .find(channel => channel.id === forward.outgoing_channel) || {};

          const inbound = nodes.find(({key}) => key === inboundChannel.key);
          const outbound = nodes.find(({key}) => key === outboundChannel.key);

          return {
            fee: forward.fee,
            inbound: inbound || {channel: forward.incoming_channel},
            outbound: outbound || {channel: forward.outgoing_channel},
            tokens: forward.tokens,
          };
        });

        const allForwards = details.map(({fee, inbound, outbound, tokens}) => {
          const fromPeer = inbound.alias || inbound.key || inbound.channel;
          const toPeer = outbound.alias || outbound.key || outbound.channel;

          const forwardFrom = `from ${fromPeer}`;
          const to = `to ${toPeer}`;

          return `- Earned ${fee} forwarding ${tokens} ${forwardFrom} ${to}`;
        });

        const text = `💰 *${from}*\n${allForwards.join('\n')}`;

        return sendMessage({id, key, request, text}, cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
