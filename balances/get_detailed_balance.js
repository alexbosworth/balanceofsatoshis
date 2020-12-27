const asyncAuto = require('async/auto');
const {formatTokens} = require('ln-sync');
const {getChainTransactions} = require('ln-service');
const {getChannels} = require('ln-service');
const {getPendingChannels} = require('ln-service');
const {getUtxos} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const detailedBalances = require('./detailed_balances');

/** Get a detailed balance that categorizes balance of tokens on the node

  {
    lnd: <Authenticated LND API Object>
  }

  @returns via cbk or Promise
  {
    [offchain_balance]: <Total Value of Channel Balances String>
    [offchain_pending]: <Total Pending Local Balance String>
    [onchain_balance]: <Collective Value of UTXOs String>
    [onchain_vbytes]: <Estimated Size of Spending On Chain Funds Number>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (args.above !== undefined) {
          return cbk([400, 'AboveQueryNotSupportedInDetailedBalanceLookup']);
        }

        if (args.below !== undefined) {
          return cbk([400, 'BelowQueryNotSupportedInDetailedBalanceLookup']);
        }

        if (args.is_confirmed) {
          return cbk([400, 'ConfirmedNotSupportedInDetailedBalanceLookup']);
        }

        if (args.is_offchain_only) {
          return cbk([400, 'OffchainOnlyNotSupportedInDetailedBalanceLookup']);
        }

        if (args.is_onchain_only) {
          return cbk([400, 'OnchainOnlyNotSupportedInDetailedBalanceLookup']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToGetDetailedBalance']);
        }

        return cbk();
      },

      // Get the channels
      getChannels: ['validate', ({}, cbk) => {
        return getChannels({lnd: args.lnd}, cbk);
      }],

      // Get pending channels
      getPending: ['validate', ({}, cbk) => {
        return getPendingChannels({lnd: args.lnd}, cbk);
      }],

      // Get the chain transactions
      getTx: ['validate', ({}, cbk) => {
        return getChainTransactions({lnd: args.lnd}, cbk);
      }],

      // Get the UTXOs
      getUtxos: ['validate', ({}, cbk) => getUtxos({lnd: args.lnd}, cbk)],

      // Calculate balance
      balance: [
        'getChannels',
        'getPending',
        'getTx',
        'getUtxos',
        ({getChannels, getPending, getTx, getUtxos}, cbk) =>
      {
        const format = tokens => formatTokens({tokens}).display.trim();

        const balances = detailedBalances({
          channels: getChannels.channels,
          pending: getPending.pending_channels,
          transactions: getTx.transactions,
          utxos: getUtxos.utxos,
        });

        return cbk(null, {
          closing_balance: format(balances.closing_balance) || undefined,
          offchain_balance: format(balances.offchain_balance) || undefined,
          offchain_pending: format(balances.offchain_pending) || undefined,
          onchain_balance: format(balances.onchain_balance) || undefined,
          onchain_vbytes: balances.onchain_vbytes || undefined,
        });
      }],
    },
    returnResult({reject, resolve, of: 'balance'}, cbk));
  });
};
