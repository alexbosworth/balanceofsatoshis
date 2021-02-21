const asyncAuto = require('async/auto');
const asyncMapSeries = require('async/mapSeries');
const {formatTokens} = require('ln-sync');
const {getChainTransactions} = require('ln-service');
const {getChannels} = require('ln-service');
const {getClosedChannels} = require('ln-service');
const {getPendingChannels} = require('ln-service');
const {getTransactionRecord} = require('ln-sync');
const {getUtxos} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const describeChan = n => `${n.action} with ${(n.node || '' + n.with).trim()}`;
const flatten = arr => [].concat(...arr);
const none = 0;
const uniq = arr => Array.from(new Set(arr));

/** Get UTXOs

  {
    [count_below]: <Return Only Count, And Below Number>
    [is_count]: <Return Only Count Bool>
    [is_confirmed]: <Return Only Confirmed Utxos Bool>
    lnd: <Authenticated gRPC LND API Object>
    [min_tokens]: <Return Utxos of Value Above Tokens Size Number>
    [node]: <Node Name String>
  }

  // Non-count response
  @returns via cbk or Promise
  {
    utxos: [{
      outpoint: <Coin Outpoint String>
      amount: <Coins Amount String>
      [confirmations]: <Confirmation Count Number>
      [is_unconfirmed]: <UTXO is Confirmed Bool>
      address: <Chain Address String>
      [related_description]: <Transaction Description String>
      [related_channels]: [<Related Channel Description String>]
    }]
  }

  // Count response
  @returns via cbk or Promise
  <Count Number>
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.lnd) {
          return cbk([400, 'ExpectedLndObjectToGetUtxos']);
        }

        return cbk();
      },

      // Get channels
      getChannels: ['validate', ({}, cbk) => {
        return getChannels({lnd: args.lnd}, cbk);
      }],

      // Get closed channels
      getClosed: ['validate', ({}, cbk) => {
        return getClosedChannels({lnd: args.lnd}, cbk);
      }],

      // Get pending transactions
      getPending: ['validate', ({}, cbk) => {
        return getPendingChannels({lnd: args.lnd}, cbk);
      }],

      // Get transactions
      getTx: ['validate', ({}, cbk) => {
        return getChainTransactions({lnd: args.lnd}, cbk);
      }],

      // Get UTXOs
      getUtxos: ['validate', ({}, cbk) => {
        return getUtxos({
          lnd: args.lnd,
          min_confirmations: !args.is_confirmed ? 0 : 1,
        },
        cbk);
      }],

      // Get related channels to UTXOs
      getRelated: [
        'getChannels',
        'getClosed',
        'getPending',
        'getTx',
        'getUtxos',
        ({getChannels, getClosed, getPending, getTx, getUtxos}, cbk) =>
      {
        // Exit early when only a count is required
        if (!!args.count_below || !!args.is_count) {
          return cbk();
        }

        const txIds = uniq(getUtxos.utxos.map(n => n.transaction_id));

        return asyncMapSeries(txIds, (id, cbk) => {
          return getTransactionRecord({
            id,
            lnd: args.lnd,
            chain_transactions: getTx.transactions,
            channels: getChannels.channels,
            closed_channels: getClosed.channels,
            pending_channels: getPending.pending_channels,
          },
          cbk);
        },
        cbk);
      }],

      // Utxos with added context or counted
      utxos: [
        'getRelated',
        'getTx',
        'getUtxos',
        ({getRelated, getTx, getUtxos}, cbk) =>
      {
        const utxos = getUtxos.utxos.filter(utxo => {
          if (!!args.min_tokens) {
            return utxo.tokens >= args.min_tokens;
          }

          return true;
        });

        // Exit early when looking for a UTXO count below n
        if (!!args.count_below) {
          const below = args.count_below;

          const total = utxos.length < below ? below - utxos.length : none;

          return cbk(null, total);
        }

        // Exit early when looking for a simple UTXO count
        if (!!args.is_count) {
          return cbk(null, utxos.length);
        }

        const unspent = utxos.map(utxo => {
          const t = getTx.transactions.find(n => n.id === utxo.transaction_id);

          const related = getRelated
            .filter(n => n.tx === utxo.transaction_id)
            .filter(n => n.related_channels.length)
            .map(n => n.related_channels)
            .map(chans => chans.map(n => describeChan(n)));

          return {
            outpoint: `${utxo.transaction_id}:${utxo.transaction_vout}`,
            amount: formatTokens({tokens: utxo.tokens}).display,
            confirmations: utxo.confirmation_count || undefined,
            is_unconfirmed: !utxo.confirmation_count || undefined,
            address: utxo.address,
            related_description: (t || {}).description || undefined,
            related_channels: !!related.length ? flatten(related) : undefined,
          };
        });

        return cbk(null, {utxos: unspent});
      }],
    },
    returnResult({reject, resolve, of: 'utxos'}, cbk));
  });
};
