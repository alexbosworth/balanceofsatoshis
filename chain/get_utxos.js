const asyncAuto = require('async/auto');
const {authenticatedLndGrpc} = require('ln-service');
const {getUtxos} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const none = 0;

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
      address: <Chain Address String>
      address_format: <Chain Address Format String>
      confirmation_count: <Confirmation Count Number>
      output_script: <Output Script Hex String>
      tokens: <Unspent Tokens Number>
      transaction_id: <Transaction Id Hex String>
      transaction_vout: <Transaction Output Index Number>
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

      // Get UTXOs
      getUtxos: ['validate', ({}, cbk) => {
        return getUtxos({
          lnd: args.lnd,
          min_confirmations: !args.is_confirmed ? 0 : 1,
        },
        cbk);
      }],

      // Utxos
      utxos: ['getUtxos', ({getUtxos}, cbk) => {
        const utxos = getUtxos.utxos.filter(utxo => {
          if (!!args.min_tokens) {
            return utxo.tokens >= args.min_tokens;
          }

          return true;
        });

        if (!!args.count_below) {
          const below = args.count_below;

          const total = utxos.length < below ? below - utxos.length : none;

          return cbk(null, total);
        }

        if (!!args.is_count) {
          return cbk(null, utxos.length);
        }

        return cbk(null, {utxos});
      }],
    },
    returnResult({reject, resolve, of: 'utxos'}, cbk));
  });
};
