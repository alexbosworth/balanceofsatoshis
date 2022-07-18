const asyncAuto = require('async/auto');
const {formatTokens} = require('ln-sync');
const {getChainTransactions} = require('ln-service');
const {getChannels} = require('ln-service');
const {getLockedUtxos} = require('ln-service');
const {getPendingChannels} = require('ln-service');
const {getUtxos} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {Transaction} = require('bitcoinjs-lib');

const detailedBalances = require('./detailed_balances');

const {fromHex} = Transaction;

/** Get a detailed balance that categorizes balance of tokens on the node

  {
    [is_confirmed]: <Only Consider Confirmed Transactions Bool>
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
        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToGetDetailedBalance']);
        }

        return cbk();
      },

      // Get the channels
      getChannels: ['validate', ({}, cbk) => {
        return getChannels({lnd: args.lnd}, cbk);
      }],

      // Get locked UTXOs
      getLocked: ['validate', ({}, cbk) => {
        return getLockedUtxos({lnd: args.lnd}, (err, res) => {
          // Ignore errors
          if (!!err) {
            return cbk(null, []);
          }

          return cbk(null, res.utxos);
        });
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

      // Cross reference locked transactions to UTXO data
      locked: ['getLocked', 'getTx', ({getLocked, getTx}, cbk) => {
        const {transactions} = getTx;

        const utxos = getLocked.map(locked => {
          // Exit early when the lock is expired
          if (locked.lock_expires_at < new Date().toISOString()) {
            return;
          }

          const tx = transactions.find(n => n.id === locked.transaction_id);

          // Exit early when there is no related confirmed transaction
          if (!tx || !tx.transaction || !tx.confirmation_count) {
            return;
          }

          const output = fromHex(tx.transaction).outs[locked.transaction_vout];

          // Exit early when the output is not found in the transaction
          if (!output) {
            return;
          }

          return {tokens: output.value};
        });

        return cbk(null, utxos.filter(n => !!n));
      }],

      // Calculate balance
      balance: [
        'getChannels',
        'getPending',
        'getTx',
        'getUtxos',
        'locked',
        ({getChannels, getPending, getTx, getUtxos, locked}, cbk) =>
      {
        const confUtxos = getUtxos.utxos.filter(n => !!n.confirmation_count);
        const confirmedTx = getTx.transactions.filter(n => !!n.is_confirmed);
        const format = tokens => formatTokens({tokens}).display.trim();

        const confirmed = detailedBalances({
          locked,
          channels: getChannels.channels,
          pending: getPending.pending_channels,
          transactions: confirmedTx,
          utxos: confUtxos,
        });

        const unconfirmed = detailedBalances({
          locked,
          channels: getChannels.channels,
          pending: getPending.pending_channels,
          transactions: getTx.transactions,
          utxos: getUtxos.utxos,
        });

        const balances = !!args.is_confirmed ? confirmed : unconfirmed;
        const limbo = unconfirmed.onchain_balance - confirmed.onchain_balance;

        return cbk(null, {
          closing_balance: format(balances.closing_balance) || undefined,
          conflicted_pending: format(balances.conflicted_pending) || undefined,
          invalid_pending: format(balances.invalid_pending) || undefined,
          offchain_balance: format(balances.offchain_balance) || undefined,
          offchain_pending: format(balances.offchain_pending) || undefined,
          onchain_confirmed: format(confirmed.onchain_balance) || undefined,
          onchain_pending: format(limbo) || undefined,
          onchain_vbytes: balances.onchain_vbytes || undefined,
          utxos_count: getUtxos.utxos.length || undefined,
        });
      }],
    },
    returnResult({reject, resolve, of: 'balance'}, cbk));
  });
};
