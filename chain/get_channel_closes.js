const asyncAuto = require('async/auto');
const asyncMapSeries = require('async/mapSeries');
const {getChainTransactions} = require('ln-service');
const {getClosedChannels} = require('ln-service');
const {getHeight} = require('ln-service');
const {getNodeAlias} = require('ln-sync');
const {getPendingChannels} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const anchorOutput = require('./anchor_output');
const closeResolutions = require('./close_resolutions');
const closingFees = require('./closing_fees');
const contractOutputs = require('./contract_outputs');
const getCloseTransactions = require('./get_close_transactions');

const defaultLimit = 20;
const flatten = arr => [].concat(...arr);

/** Get the last channel close outcomes

  {
    [limit]: <Limit Number>
    lnd: <Authenticated LND API Object>
  }

  @returns via cbk or Promise
  {
    closes: [{
      peer_public_key: <Peer Public Key Hex String>
      [peer_alias]: <Peer Alias Strring>
      [is_local_force_close]: <Channel Was Locally Force Closed Bool>
      [is_cooperative_close]: <Channel Was Cooperatively Closed Bool>
      [is_remote_force_close]: <Channel was Remotely Force Closed Bool>
      [peer_opened_channel]: <Peer Opened the Channel Bool>
      [peer_closed_channel]: <Peer Closed the Channel Bool>
      blocks_since_close: <Count of Blocks Since Close Number>
      capacity: <Channel Capacity Tokens Number>
      [channel_id]: <Channel Id String>
      channel_open: <Channel Funding Outpoint String>
      channel_close: <Channel Close Transaction Id Hex String>
      [channel_balance_spend]: <Channel Balance Spent In Tx Id Hex String>
      [channel_resolutions]: [{
        [transaction_id]: <Latest Resolving Transaction Id Hex String>
        type: <Resolution Type String>
        [value]: <Value Number>
      }]
      [is_breach_close]: <Channel Was Breach Closed Bool>
      [closing_fee_paid]: <Closing Fees Paid Related To Channel Tokens Number>
      [is_closing_fee_unknown]: <Closing Fees Paid Are Not Known Bool>
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
      getHeight: ['validate', ({}, cbk) => getHeight({lnd}, cbk)],

      // Get pending channels, their outputs may share resolving transactions
      getPending: ['validate', ({}, cbk) => getPendingChannels({lnd}, cbk)],

      // Get on-chain transactions
      getTx: ['validate', ({}, cbk) => getChainTransactions({lnd}, cbk)],

      // Select the most recent closed channels
      getChannels: ['getClosed', ({getClosed}, cbk) => {
        const closedChannels = getClosed.channels
          .reverse()
          .filter(channel => !!channel.close_transaction_id)
          .filter(channel => !channel.is_funding_cancel);

        const channels = closedChannels.slice(Number(), limit || defaultLimit);

        return cbk(null, channels);
      }],

      // Get the aliases of the closed channel peers
      getAliases: ['getChannels', ({getChannels}, cbk) => {
        return asyncMapSeries(getChannels, (channel, cbk) => {
          return getNodeAlias({lnd, id: channel.partner_public_key}, cbk);
        },
        cbk);
      }],

      // Get close transactions that are not in the wallet from LND
      getCloseTxs: ['getChannels', 'getTx', ({getChannels, getTx}, cbk) => {
        return getCloseTransactions({
          lnd,
          channels: getChannels,
          transactions: getTx.transactions,
        },
        cbk);
      }],

      // Channel closes
      closes: [
        'getAliases',
        'getChannels',
        'getClosed',
        'getCloseTxs',
        'getHeight',
        'getPending',
        'getTx',
        ({
          getAliases,
          getChannels,
          getClosed,
          getCloseTxs,
          getHeight,
          getPending,
          getTx,
        },
        cbk) =>
      {
        // Close transactions found by LND are added to the wallet transactions
        const transactions = []
          .concat(getTx.transactions)
          .concat(getCloseTxs.transactions);

        // Close tx outputs and HTLC tx outputs belong to closed channels
        const closedContractOutputs = getClosed.channels.map(channel => {
          return contractOutputs({
            close_transaction_id: channel.close_transaction_id,
            payments: channel.close_payments,
          });
        });

        // Pending close tx outputs and HTLC outputs belong to closing channels
        const pendingContractOutputs = getPending.pending_channels.map(n => {
          return contractOutputs({
            close_transaction_id: n.close_transaction_id,
            payments: n.pending_payments || [],
          });
        });

        const allContractOutputs = flatten([]
          .concat(closedContractOutputs)
          .concat(pendingContractOutputs));

        const closes = getChannels.map((channel, i) => {
          const {alias} = getAliases[i];
          const currentHeight = getHeight.current_block_height;
          const init = `${channel.transaction_id}:${channel.transaction_vout}`;
          const isRemoteForceClose = channel.is_remote_force_close;

          // Outputs of this channel are not shared with other channels
          const ownContractOutputs = contractOutputs({
            close_transaction_id: channel.close_transaction_id,
            payments: channel.close_payments,
          });

          const otherContractOutputs = allContractOutputs.filter(output => {
            return !ownContractOutputs.find(own => {
              return own.id === output.id && own.vout === output.vout;
            });
          });

          const closeTx = transactions
            .filter(n => !!n.transaction)
            .find(n => n.id === channel.close_transaction_id);

          // Our anchor output is found in the close tx when it is not reported
          const anchor = anchorOutput({
            anchor_vout: channel.anchor_vout,
            close_balance_spent_by: channel.close_balance_spent_by,
            close_balance_vout: channel.close_balance_vout,
            close_payments: channel.close_payments,
            close_transaction_id: channel.close_transaction_id,
            is_cooperative_close: channel.is_cooperative_close,
            transaction: !!closeTx ? closeTx.transaction : undefined,
          });

          const closingFeePaid = closingFees({
            transactions,
            anchor_is_confirmed: channel.anchor_is_confirmed,
            anchor_is_pending: channel.anchor_is_pending,
            anchor_spent_by: channel.anchor_spent_by,
            anchor_vout: anchor.vout,
            capacity: channel.capacity,
            close_balance_spent_by: channel.close_balance_spent_by,
            close_payments: channel.close_payments,
            close_transaction_id: channel.close_transaction_id,
            is_cooperative_close: channel.is_cooperative_close,
            is_partner_closed: channel.is_partner_closed,
            is_partner_initiated: channel.is_partner_initiated,
            other_contract_outputs: otherContractOutputs,
          });

          const isFeeUnknown = closingFeePaid.fees === undefined;

          const {resolutions} = closeResolutions({
            transactions,
            anchor_is_confirmed: channel.anchor_is_confirmed,
            anchor_is_pending: channel.anchor_is_pending,
            anchor_spent_by: channel.anchor_spent_by,
            anchor_vout: anchor.vout,
            close_balance_spent_by: channel.close_balance_spent_by,
            close_balance_vout: channel.close_balance_vout,
            close_payments: channel.close_payments,
            close_transaction_id: channel.close_transaction_id,
          });

          return {
            peer_public_key: channel.partner_public_key,
            peer_alias: alias || undefined,
            is_local_force_close: channel.is_local_force_close || undefined,
            is_cooperative_close: channel.is_cooperative_close || undefined,
            is_remote_force_close: isRemoteForceClose || undefined,
            peer_opened_channel: channel.is_partner_initiated || undefined,
            peer_closed_channel: channel.is_partner_closed || undefined,
            blocks_since_close: currentHeight - channel.close_confirm_height,
            capacity: channel.capacity,
            channel_id: channel.id || undefined,
            channel_open: init,
            channel_close: channel.close_transaction_id,
            channel_balance_spend: channel.close_balance_spent_by || undefined,
            channel_resolutions: !resolutions.length ? undefined : resolutions,
            is_breach_close: channel.is_breach_close || undefined,
            closing_fee_paid: closingFeePaid.fees || undefined,
            is_closing_fee_unknown: isFeeUnknown || undefined,
          };
        });

        return cbk(null, {closes: closes.reverse()});
      }],
    },
    returnResult({reject, resolve, of :'closes'}, cbk));
  });
};
