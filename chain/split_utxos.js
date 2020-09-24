const asyncAuto = require('async/auto');
const asyncMapSeries = require('async/mapSeries');
const {createChainAddress} = require('ln-service');
const {getUtxos} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {sendToChainAddresses} = require('ln-service');

const consumedUtxoCount = 1;
const decBase = 10;
const format ='p2wpkh';
const minimumUtxoTokens = 1e5;
const newArrayOfSize = n => Array.from(Array(n));

/** Ensure there are a certain number of utxos greater than or equal to a size

  Note: this is not efficient with respect to inputs. It may result in
  over-selected inputs in funding the transaction.

  {
    count: <Count of UTXOs Number>
    [is_confirmed]: <Only Consider Confirmed Utxos Bool>
    [is_dry_run]: <Do Not Execute Split Bool>
    lnd: <Authenticated LND API Object>
    size: <UTXO Minimum Tokens Number>
    [tokens_per_vbyte]: <Fee Tokens Per Virtual Byte Number>
  }
*/
module.exports = (args, cbk) => {
  return asyncAuto({
    // Check arguments
    validate: cbk => {
      if (!args.count) {
        return cbk([400, 'ExpectedSplitUtxosCountNumber']);
      }

      if (!args.lnd) {
        return cbk([400, 'ExpectedAuthenticatedLndToSplitUtxos']);
      }

      if (!args.size || args.size < minimumUtxoTokens) {
        return cbk([400, 'ExpectedSizeOfUtxosToSplitTo']);
      }

      return cbk();
    },

    // Get all the current confirmed UTXOs
    getUtxos: ['validate', ({}, cbk) => getUtxos({lnd: args.lnd}, cbk)],

    // Determine the missing count of utxos
    outputCount: ['getUtxos', ({getUtxos}, cbk) => {
      const {utxos} = getUtxos;

      const existing = utxos.filter(utxo => {
        if (!!args.is_confirmed && !utxo.confirmation_count) {
          return false;
        }

        return utxo.tokens >= args.size;
      });

      if (existing.length > args.count) {
        return cbk(null, [].length);
      }

      return cbk(null, args.count - existing.length - consumedUtxoCount);
    }],

    // UTXOs have to be of a certain size
    checkFunds: ['getUtxos', 'outputCount', ({getUtxos, outputCount}, cbk) => {
      // Exit early when there are no needed utxos
      if (!outputCount) {
        return cbk();
      }

      const utxos = getUtxos.utxos.filter(n => !!n.confirmation_count);

      const tokens = utxos.reduce((sum, n) => sum + n.tokens, 0);

      if (outputCount * args.size > tokens) {
        return cbk([400, 'InsufficientBalanceToSplitUtxos']);
      }

      return cbk();
    }],

    // Generate addresses
    getAddresses: ['checkFunds', 'outputCount', ({outputCount}, cbk) => {
      if (!!args.is_dry_run) {
        return cbk(null, []);
      }

      return asyncMapSeries(newArrayOfSize(outputCount), (_, cbk) => {
       return createChainAddress({format, lnd: args.lnd}, cbk);
      },
      cbk);
    }],

    // Send to multiple outputs
    splitUtxos: [
      'getAddresses',
      'outputCount',
      ({getAddresses, outputCount}, cbk) =>
    {
      if (!!args.is_dry_run) {
        return cbk(null, {});
      }

      const tokens = args.size;

      return sendToChainAddresses({
        fee_tokens_per_vbyte: args.tokens_per_vbyte || undefined,
        lnd: args.lnd,
        send_to: getAddresses.map(({address}) => ({address, tokens})),
      },
      cbk);
    }],

    // Utxos
    utxos: [
      'getAddresses',
      'outputCount',
      'splitUtxos',
      ({getAddresses, outputCount, splitUtxos}, cbk) =>
    {
      return cbk(null, {
        needed_outputs: outputCount,
        sent_to: getAddresses.map(({address}) => address),
        transaction_id: splitUtxos.id
      });
    }],
  },
  returnResult({of: 'utxos'}, cbk));
};
