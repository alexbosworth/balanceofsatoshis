const asyncAuto = require('async/auto');
const {authenticatedLndGrpc} = require('ln-service');
const {getUtxos} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const {lndCredentials} = require('./../lnd');

const noTokens = 0;

/** Get UTXOs

  {
    [count_below]: <Return Only Count, And Below Number>
    [is_count]: <Return Only Count Bool>
    [is_confirmed]: <Return Only Confirmed Utxos Bool>
    [min_tokens]: <Return Utxos of Value Above Tokens Size Number>
    [node]: <Node Name String>
  }

  @returns via cbk
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
*/
module.exports = (args, cbk) => {
  return asyncAuto({
    // Credentials
    credentials: cbk => lndCredentials({node: args.node}, cbk),

    // Lnd
    lnd: ['credentials', ({credentials}, cbk) => {
      return cbk(null, authenticatedLndGrpc({
        cert: credentials.cert,
        macaroon: credentials.macaroon,
        socket: credentials.socket,
      }).lnd);
    }],

    // Get UTXOs
    getUtxos: ['lnd', ({lnd}, cbk) => {
      return getUtxos({
        lnd,
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

        const total = utxos.length < below ? below - utxos.length : noTokens;

        return cbk(null, total);
      }

      if (!!args.is_count) {
        return cbk(null, utxos.length);
      }

      return cbk(null, {utxos});
    }],
  },
  returnResult({of: 'utxos'}, cbk));
};
