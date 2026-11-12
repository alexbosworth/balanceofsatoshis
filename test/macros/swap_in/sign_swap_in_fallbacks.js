const asyncAuto = require('async/auto');
const asyncMapSeries = require('async/mapSeries');
const {returnResult} = require('asyncjs-util');
const {swapInServiceFallbackTx} = require('goldengate');

const finishSharedSessions = require('./finish_shared_sessions');

/** Sign the fallback HTLC transactions of a swap in with the client sigs

  {
    lnd: <Authenticated LND API Object>
    signatures: [{
      nonces: [<Client Nonce Hex String>]
      sigs: [<Client Partial Signature Hex String>]
      type: <Fallback Type String>
    }]
    swap: <Swap In Object>
  }

  @returns via cbk or Promise
  {
    transactions: [{
      id: <HTLC Transaction Id Hex String>
      signatures: [<Deposit Input Signature Hex String>]
      transaction: <Unsigned HTLC Transaction Hex String>
      type: <Fallback Type String>
    }]
  }
*/
module.exports = ({lnd, signatures, swap}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedLndToSignSwapInFallbacks']);
        }

        if (!signatures) {
          return cbk([400, 'ExpectedClientSignaturesToSignSwapInFallbacks']);
        }

        if (!swap) {
          return cbk([400, 'ExpectedSwapToSignSwapInFallbacks']);
        }

        const types = swap.fallbacks.map(n => n.type);

        if (types.some(type => !signatures.find(n => n.type === type))) {
          return cbk([400, 'ExpectedSignaturesForEveryFallbackType']);
        }

        return cbk();
      },

      // Build and sign the HTLC transaction at every fee rate
      sign: ['validate', ({}, cbk) => {
        const [{address}] = swap.deposits;

        return asyncMapSeries(swap.fallbacks, (fallback, cbk) => {
          const signed = signatures.find(n => n.type === fallback.type);

          const {hashes, id, transaction} = swapInServiceFallbackTx({
            fee_tokens_per_kw: fallback.fee_tokens_per_kw,
            output_script: address.output_script,
            script: swap.htlc.script,
            tokens: swap.tokens,
            utxos: swap.deposits,
          });

          if (signed.nonces.length !== hashes.length) {
            return cbk([400, 'ExpectedClientNonceForEveryFallbackInput']);
          }

          if (signed.sigs.length !== hashes.length) {
            return cbk([400, 'ExpectedClientSignatureForEveryFallbackInput']);
          }

          return finishSharedSessions({
            lnd,
            inputs: hashes.map((hash, i) => ({
              hash,
              id: fallback.sessions[i].id,
              nonce: signed.nonces[i],
              signature: signed.sigs[i],
            })),
          },
          (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            return cbk(null, {
              id,
              transaction,
              signatures: res.signatures,
              type: fallback.type,
            });
          });
        },
        cbk);
      }],

      // Signed fallback transactions
      transactions: ['sign', ({sign}, cbk) => cbk(null, {transactions: sign})],
    },
    returnResult({reject, resolve, of: 'transactions'}, cbk));
  });
};
