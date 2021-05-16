const asyncAuto = require('async/auto');
const asyncMapSeries = require('async/mapSeries');
const {getChainTransactions} = require('ln-service');
const {getClosedChannels} = require('ln-service');
const {getHeight} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {getNode} = require('ln-service');
const {getNodeAlias} = require('ln-sync');
const {returnResult} = require('asyncjs-util');

const closingFees = require('./closing_fees');
const getChannelResolution = require('./get_channel_resolution');

const defaultLimit = 20;

/** Get the last channel close outcomes

  {
    [limit]: <Limit Number>
    lnd: <Authenticated LND API Object>
    request: <Request Function>
  }

  @returns via cbk or Promise
  {
    peer_public_key: <Peer Public Key Hex String>
    [peer_alias]: <Peer Alias Strring>
    [is_local_force_close]: <Channel Was Locally Force Closed Bool>
    [is_cooperative_close]: <Channel Was Cooperatively Closed Bool>
    [is_remote_force_close]: <Channel was Remotely Force Closed Bool>
    [peer_closed_channel]: <Peer Closed the Channel Bool>
    blocks_since_close: <Count of Blocks Since Close Number>
    capacity: <Channel Capacity Tokens Number>
    [channel_id]: <Channel Id String>
    channel_open: <Channel Funding Outpoint String>
    channel_close: <Channel Close Transaction Id Hex String>
    [channel_balance_spend]: <Channel Balance Spent In Tx Id Hex String>
    [channel_resolutions]: [{
      type: <Resolution Type String>
      value: <Value Number>
    }]
    [is_breach_close]: <Channel Was Breach Closed Bool>
    [closing_fee_paid]: <Closing Fees Paid Related To Channel Tokens Number>
  }
*/
module.exports = ({limit, lnd, request}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedLndToGetChannelCloses']);
        }

        if (!request) {
          return cbk([400, 'ExpectedRequestFunctionToGetChannelCloses']);
        }

        return cbk();
      },

      // Get closed channels
      getClosed: ['validate', ({}, cbk) => getClosedChannels({lnd}, cbk)],

      // Get the current height
      getHeight: ['validate', ({}, cbk) => getHeight({lnd}, cbk)],

      // Get the network
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd}, cbk)],

      // Get on-chain transactions
      getTx: ['validate', ({}, cbk) => getChainTransactions({lnd}, cbk)],

      // Get spends
      getSpends: [
        'getClosed',
        'getHeight',
        'getNetwork',
        'getTx',
        async ({getClosed, getHeight, getNetwork, getTx}) =>
      {
        const closedChannels = getClosed.channels
          .reverse()
          .filter(channel => !!channel.close_transaction_id)
          .filter(channel => !channel.is_funding_cancel);

        const channels = closedChannels.slice(Number(), limit || defaultLimit);

        return await asyncMapSeries(channels, async channel => {
          const {resolutions} = await getChannelResolution({
            request,
            close_transaction_id: channel.close_transaction_id,
            is_cooperative_close: channel.is_cooperative_close,
            network: getNetwork.network,
            transactions: getTx.transactions.filter(n => !!n.transaction),
          });

          const {alias} = await getNodeAlias({
            lnd,
            id: channel.partner_public_key,
          });

          const currentHeight = getHeight.current_block_height;
          const isRemoteForceClose = channel.is_remote_force_close;
          const init = `${channel.transaction_id}:${channel.transaction_vout}`;

          const closingFeePaid = closingFees({
            capacity: channel.capacity,
            close_balance_spent_by: channel.close_balance_spent_by,
            close_transaction_id: channel.close_transaction_id,
            is_partner_initiated: channel.is_partner_initiated,
            transactions: getTx.transactions,
          });

          return {
            peer_public_key: channel.partner_public_key,
            peer_alias: alias || undefined,
            is_local_force_close: channel.is_local_force_close || undefined,
            is_cooperative_close: channel.is_cooperative_close || undefined,
            is_remote_force_close: isRemoteForceClose || undefined,
            peer_closed_channel: channel.is_partner_closed || undefined,
            blocks_since_close: currentHeight - channel.close_confirm_height,
            capacity: channel.capacity,
            channel_id: channel.id || undefined,
            channel_open: init,
            channel_close: channel.close_transaction_id,
            channel_balance_spend: channel.close_balance_spent_by || undefined,
            channel_resolutions: resolutions || undefined,
            is_breach_close: channel.is_breach_close || undefined,
            closing_fee_paid: closingFeePaid.fees || undefined,
          };
        });
      }],

      // Channel closes
      closes: ['getSpends', ({getSpends}, cbk) => {
        return cbk(null, {closes: getSpends.slice().reverse()});
      }],
    },
    returnResult({reject, resolve, of :'closes'}, cbk));
  });
};
