const asyncAuto = require('async/auto');
const {getChannels} = require('ln-service');
const {getNode} = require('ln-service');
const {getPendingChannels} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const peerLiquidity = require('./peer_liquidity');

/** Get the rundown on liquidity with a specific peer

  {
    lnd: <Authenticated LND gRPC API Object>
    public_key: <Peer Public Key Hex String>
    [settled]: <Known Settled Payment Id String>
  }

  @returns via cbk or Promise
  {
    alias: <Alias String>
    inbound: <Inbound Liquidity Tokens Number>
    inbound_pending: <Pending Inbound Liquidity Tokens Number>
    outbound: <Outbound Liquidity Tokens Number>
    outbound_pending: <Pending Outbound Liquidity Tokens Number>
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
        (err, res) => {
          if (!!err) {
            return cbk(null, {alias: String(), public_key: args.public_key});
          }

          return cbk(null, res);
        });
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

        const opening = getPendingChannels.pending_channels.filter(chan => {
          return chan.is_opening && chan.partner_public_key == args.public_key;
        });

        const liquidity = peerLiquidity({
          channels,
          opening,
          settled: args.settled,
        });

        return cbk(null, {
          alias: getNode.alias,
          inbound: liquidity.inbound,
          inbound_opening: liquidity.inbound_opening,
          inbound_pending: liquidity.inbound_pending,
          outbound: liquidity.outbound,
          outbound_opening: liquidity.outbound_opening,
          outbound_pending: liquidity.outbound_pending,
        });
      }],
    },
    returnResult({reject, resolve, of: 'liquidity'}, cbk));
  });
};
