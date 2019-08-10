const asyncAuto = require('async/auto');
const asyncMapSeries = require('async/mapSeries');
const {authenticatedLndGrpc} = require('ln-service');
const {getClosedChannels} = require('ln-service');
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
    [node]: <Node Name String>
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
module.exports = (args, cbk) => {
  return asyncAuto({
    // Get lnd
    getLnd: cbk => authenticatedLnd({node: args.node}, cbk),

    // Lnd
    lnd: ['getLnd', ({getLnd}, cbk) => cbk(null, getLnd.lnd)],

    // Get closed channels
    getClosed: ['lnd', ({lnd}, cbk) => getClosedChannels({lnd}, cbk)],

    // Get the current height
    getHeight: ['lnd', ({lnd}, cbk) => getWalletInfo({lnd}, cbk)],

    // Get the network
    getNetwork: ['lnd', ({lnd}, cbk) => getNetwork({lnd}, cbk)],

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

      const limit = args.limit || defaultLimit;

      return asyncMapSeries(take(closedChannels, limit), (channel, cbk) => {
        return getChannelResolution({
          close_transaction_id: channel.close_transaction_id,
          is_cooperative_close: channel.is_cooperative_close,
          network: getNetwork.network,
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          const currentHeight = getHeight.current_block_height;

          return cbk(null, {
            blocks_since_close: currentHeight - channel.close_confirm_height,
            capacity: channel.capacity,
            close_transaction_id: channel.close_transaction_id,
            is_breach_close: channel.is_breach_close || undefined,
            is_cooperative_close: channel.is_cooperative_close || undefined,
            is_local_force_close: channel.is_local_force_close || undefined,
            is_remote_force_close: channel.is_remote_force_close || undefined,
            output_resolutions: res.resolutions || undefined,
            partner_public_key: channel.partner_public_key,
            transaction_id: channel.transaction_id,
            transaction_vout: channel.transaction_vout,
          });
        });
      },
      (err, closes) => {
        if (!!err) {
          return cbk(err);
        }

        return cbk(null, {closes: closes.reverse()});
      });
    }],
  },
  returnResult({of :'getSpends'}, cbk));
};
