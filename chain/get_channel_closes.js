const asyncAuto = require('async/auto');
const asyncMapSeries = require('async/mapSeries');
const {authenticatedLndGrpc} = require('ln-service');
const {getClosedChannels} = require('ln-service');
const {getNode} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {take} = require('lodash');

const {authenticatedLnd} = require('./../lnd');
const getChannelResolution = require('./get_channel_resolution');
const {getNetwork} = require('./../network');

const defaultLimit = 20;

/** Get the last channel close outcomes

  {
    [limit]: <Limit Number>
    lnd: <Authenticated LND gRPC API Object>
  }

  @returns via cbk
  {
    closes: [{
      blocks_since_close: <Blocks Since Close Number>
      capacity: <Channel Capacity Value Number>
      close_transaction_id: <Close Transaction Id Hex String>
      [is_breach_close]: <Channel is Breach Close Bool>
      [is_cooperative_close]: <Channel is Cooperative Close Bool>
      [is_local_force_close]: <Channel is Local Force Close Bool>
      [is_remote_force_close]: <Channel is Remote Force Close Bool>
      [output_resolutions]: [{
        type: <Type String>
        value: <Value Number>
      }]
      partner_public_key: <Channel Partner Public Key Hex String>
      transaction_id: <Transaction Id Hex String>
      transaction_vout: <Transaction Output Index Number>
    }]
  }
*/
module.exports = ({limit, lnd}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedLndToGetChannelCloses']);
        }

        return cbk();
      },

      // Get closed channels
      getClosed: ['validate', ({}, cbk) => getClosedChannels({lnd}, cbk)],

      // Get the current height
      getHeight: ['validate', ({}, cbk) => getWalletInfo({lnd}, cbk)],

      // Get the network
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd}, cbk)],

      // Get spends
      getSpends: [
        'getClosed',
        'getHeight',
        'getNetwork',
        ({getClosed, getHeight, getNetwork}, cbk) =>
      {
        const closedChannels = getClosed.channels
          .reverse()
          .filter(channel => !channel.is_funding_cancel);

        const num = limit || defaultLimit;

        return asyncMapSeries(take(closedChannels, num), (channel, cbk) => {
          return getChannelResolution({
            close_transaction_id: channel.close_transaction_id,
            is_cooperative_close: channel.is_cooperative_close,
            network: getNetwork.network,
          },
          async (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            let alias;
            const currentHeight = getHeight.current_block_height;
            const isRemoteForceClose = channel.is_remote_force_close;

            try {
              const node = await getNode({
                lnd,
                is_omitting_channels: true,
                public_key: channel.partner_public_key,
              });

              alias = node.alias;
            } catch (err) {}

            return cbk(null, {
              alias: alias || undefined,
              blocks_since_close: currentHeight - channel.close_confirm_height,
              capacity: channel.capacity,
              close_transaction_id: channel.close_transaction_id,
              is_breach_close: channel.is_breach_close || undefined,
              is_cooperative_close: channel.is_cooperative_close || undefined,
              is_local_force_close: channel.is_local_force_close || undefined,
              is_remote_force_close: isRemoteForceClose || undefined,
              output_resolutions: res.resolutions || undefined,
              partner_public_key: channel.partner_public_key,
              transaction_id: channel.transaction_id,
              transaction_vout: channel.transaction_vout,
            });
          });
        },
        cbk);
      }],

      // Channel closes
      closes: ['getSpends', ({getSpends}, cbk) => {
        return cbk(null, {closes: getSpends.slice().reverse()});
      }],
    },
    returnResult({reject, resolve, of :'closes'}, cbk));
  });
};
