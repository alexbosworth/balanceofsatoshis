const asyncAuto = require('async/auto');
const asyncify = require('async/asyncify');
const asyncMapSeries = require('async/mapSeries');
const {componentsOfTransaction} = require('@alexbosworth/blockchain');
const {p2wshOutputScript} = require('goldengate');
const {returnResult} = require('asyncjs-util');
const {signSwapInFallbackRefund} = require('goldengate');

const {refundDustErrors} = require('./constants');
const {sharedAddressKeyFamily} = require('./constants');

const flatten = arr => [].concat(...arr);
const {isArray} = Array;
const isDustError = err => !!err && refundDustErrors.includes(err[1]);
const notFound = -1;

/** Sign refunds of swap in fallback HTLCs at fee rates that unlock at heights

  {
    fallbacks: [{
      id: <HTLC Transaction Id Hex String>
      transaction: <Unsigned HTLC Transaction Hex String>
      type: <Fallback Fee Rate Type String>
    }]
    hash: <Swap Hash Hex String>
    key_index: <HTLC Refund Key Index Number>
    lnd: <Authenticated LND API Object>
    network: <Network Name String>
    rates: [{
      fee_rate: <Fee Tokens Per VByte Number>
      height: <Timelock Block Height At or After the Timeout Number>
    }]
    script: <Swap HTLC Witness Script Hex String>
    service_public_key: <Service HTLC Public Key Hex String>
    sweep_address: <Refund to Chain Address String>
    timeout: <Swap HTLC Timeout Height Number>
  }

  @returns via cbk or Promise
  {
    refunds: [{
      fee_rate: <Fee Tokens Per VByte Number>
      height: <Timelock Block Height Number>
      id: <Refund Transaction Id Hex String>
      transaction: <Signed Refund Transaction Hex String>
      type: <Refunded Fallback Fee Rate Type String>
    }]
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isArray(args.fallbacks) || !args.fallbacks.length) {
          return cbk([400, 'ExpectedFallbacksToSignHtlcRefunds']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToSignHtlcRefunds']);
        }

        if (!isArray(args.rates) || !args.rates.length) {
          return cbk([400, 'ExpectedFeeRatesToSignHtlcRefunds']);
        }

        if (!args.script) {
          return cbk([400, 'ExpectedHtlcScriptToSignHtlcRefunds']);
        }

        return cbk();
      },

      // Decode the fallback transactions
      decode: ['validate', asyncify(() => {
        try {
          return args.fallbacks.map(({transaction}) => {
            return componentsOfTransaction({transaction});
          });
        } catch (err) {
          throw [503, 'FailedToDecodeSwapInFallbackTx', {err}];
        }
      })],

      // Find the HTLC output in every fallback transaction
      htlcs: ['decode', asyncify(({decode}) => {
        const {output} = p2wshOutputScript({script: args.script});

        return args.fallbacks.map((fallback, i) => {
          const {outputs} = decode[i];

          const vout = outputs.findIndex(n => n.script === output);

          // Every fallback pays to the HTLC that was derived here
          if (vout === notFound) {
            throw [503, 'ExpectedHtlcOutputInSwapInFallbackTx', {fallback}];
          }

          return {
            tokens: outputs[vout].tokens,
            transaction_id: fallback.id,
            transaction_vout: vout,
            type: fallback.type,
          };
        });
      })],

      // Sign a refund of every fallback HTLC at every fee rate
      sign: ['htlcs', ({htlcs}, cbk) => {
        const spends = flatten(htlcs.map(htlc => {
          return args.rates.map(rate => ({htlc, rate}));
        }));

        return asyncMapSeries(spends, ({htlc, rate}, cbk) => {
          return signSwapInFallbackRefund({
            block_height: rate.height,
            fee_tokens_per_vbyte: rate.fee_rate,
            hash: args.hash,
            key_family: sharedAddressKeyFamily,
            key_index: args.key_index,
            lnd: args.lnd,
            network: args.network,
            service_public_key: args.service_public_key,
            sweep_address: args.sweep_address,
            timeout: args.timeout,
            utxos: [{
              tokens: htlc.tokens,
              transaction_id: htlc.transaction_id,
              transaction_vout: htlc.transaction_vout,
            }],
          },
          (err, res) => {
            // Exit early when the fee rate leaves too little to refund
            if (isDustError(err)) {
              return cbk();
            }

            if (!!err) {
              return cbk(err);
            }

            return cbk(null, {
              fee_rate: rate.fee_rate,
              height: rate.height,
              id: res.id,
              transaction: res.transaction,
              type: htlc.type,
            });
          });
        },
        cbk);
      }],

      // The refunds that are above dust
      refunds: ['sign', ({sign}, cbk) => {
        return cbk(null, {refunds: sign.filter(n => !!n)});
      }],
    },
    returnResult({reject, resolve, of: 'refunds'}, cbk));
  });
};
