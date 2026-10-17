const asyncAuto = require('async/auto');
const asyncMapSeries = require('async/mapSeries');
const {returnResult} = require('asyncjs-util');

const getCloseFromSpend = require('./get_close_from_spend');
const getClosesInBlocks = require('./get_closes_in_blocks');

const {isArray} = Array;

/** Get close transactions that are missing from the wallet transactions

  A close transaction spends the channel funding output. When the funding
  transaction is in the wallet, LND can find the close transaction by looking
  for the spend of the funding output.

  When the spend is not found that way, the close transaction is looked for in
  the block that it was confirmed in using the LND chain backend.

  {
    channels: [{
      [close_confirm_height]: <Close Confirmed At Height Number>
      close_transaction_id: <Close Transaction Id Hex String>
      transaction_id: <Funding Transaction Id Hex String>
      transaction_vout: <Funding Transaction Output Index Number>
    }]
    lnd: <Authenticated LND API Object>
    transactions: [{
      id: <Transaction Id Hex String>
      [transaction]: <Raw Transaction Hex String>
    }]
  }

  @returns via cbk or Promise
  {
    transactions: [{
      id: <Close Transaction Id Hex String>
      transaction: <Raw Close Transaction Hex String>
    }]
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isArray(args.channels)) {
          return cbk([400, 'ExpectedChannelsToGetCloseTransactions']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToGetCloseTransactions']);
        }

        if (!isArray(args.transactions)) {
          return cbk([400, 'ExpectedTransactionsToGetCloseTransactions']);
        }

        return cbk();
      },

      // Channels with a close tx missing from the wallet and a height to look
      missing: ['validate', ({}, cbk) => {
        const knownIds = args.transactions
          .filter(n => !!n.transaction)
          .map(n => n.id);

        const channels = args.channels
          .filter(n => !!n.close_confirm_height)
          .filter(n => !knownIds.includes(n.close_transaction_id));

        return cbk(null, channels);
      }],

      // Look for the close transactions as spends of the funding outputs
      getSpends: ['missing', ({missing}, cbk) => {
        return asyncMapSeries(missing, (channel, cbk) => {
          return getCloseFromSpend({
            close_confirm_height: channel.close_confirm_height,
            close_transaction_id: channel.close_transaction_id,
            lnd: args.lnd,
            transaction_id: channel.transaction_id,
            transaction_vout: channel.transaction_vout,
            transactions: args.transactions,
          },
          cbk);
        },
        cbk);
      }],

      // Find the remaining close transactions in their confirmation blocks
      getBlockTxs: ['getSpends', 'missing', ({getSpends, missing}, cbk) => {
        const found = getSpends.filter(n => !!n.id).map(n => n.id);

        const remaining = missing.filter(channel => {
          return !found.includes(channel.close_transaction_id);
        });

        return getClosesInBlocks({channels: remaining, lnd: args.lnd}, cbk);
      }],

      // Close transactions that were found
      transactions: [
        'getBlockTxs',
        'getSpends',
        ({getBlockTxs, getSpends}, cbk) =>
      {
        const transactions = []
          .concat(getSpends.filter(n => !!n.transaction))
          .concat(getBlockTxs.transactions);

        return cbk(null, {transactions});
      }],
    },
    returnResult({reject, resolve, of: 'transactions'}, cbk));
  });
};
