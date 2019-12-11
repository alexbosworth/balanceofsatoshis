const asyncAuto = require('async/auto');
const {getChannels} = require('ln-service');
const {getNode} = require('ln-service');
const {getPendingChannels} = require('ln-service');
const {returnResult} = require('asyncjs-util');

/** Get the rundown on liquidity with a specific peer

  {
    lnd: <Authenticated LND gRPC API Object>
    public_key: <Peer Public Key Hex String>
  }

  @returns via cbk or Promise
  {
    alias: <Alias String>
    inbound: <Inbound Liquidity Tokens Number>
    outbound: <Outbound Liquidity Tokens Number>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToGetPeerLiquidity']);
        }

        if (!args.public_key) {
          return cbk([400, 'ExpectedPublicKeyToGetPeerLiquidity']);
        }

        return cbk();
      },

      // Get channels
      getChannels: ['validate', ({}, cbk) => {
        return getChannels({lnd: args.lnd}, cbk);
      }],

      // Get node information
      getNode: ['validate', ({}, cbk) => {
        return getNode({
          is_omitting_channels: true,
          lnd: args.lnd,
          public_key: args.public_key,
        },
        cbk);
      }],

      // Get pending channels
      getPendingChannels: ['validate', ({}, cbk) => {
        return getPendingChannels({lnd: args.lnd}, cbk);
      }],

      // Liquidity totals
      liquidity: [
        'getChannels',
        'getNode',
        'getPendingChannels',
        ({getChannels, getNode, getPendingChannels}, cbk) =>
      {
        const channels = getChannels.channels.filter(channel => {
          return channel.partner_public_key === args.public_key;
        });

        const inbound = channels.reduce((sum, n) => sum + n.remote_balance, 0);
        const outbound = channels.reduce((sum, n) => sum + n.local_balance, 0);

        const pendingOpen = getPendingChannels.pending_channels.filter(n => {
          return !!n.is_opening && n.partner_public_key === args.public_key;
        });

        const pendingInbound = pendingOpen.reduce((sum, channel) => {
          return sum + channel.remote_balance;
        },
        Number());

        const pendingOutbound = pendingOpen.reduce((sum, channel) => {
          return sum + channel.local_balance;
        },
        Number());

        return cbk(null, {
          alias: getNode.alias,
          inbound: pendingInbound + inbound,
          outbound: pendingOutbound + outbound,
        });
      }],
    },
    returnResult({reject, resolve, of: 'liquidity'}, cbk));
  });
};
