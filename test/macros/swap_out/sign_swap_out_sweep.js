const asyncAuto = require('async/auto');
const asyncify = require('async/asyncify');
const {beginGroupSigningSession} = require('ln-service');
const {componentsOfTransaction} = require('@alexbosworth/blockchain');
const {decodePsbt} = require('psbt');
const {returnResult} = require('asyncjs-util');
const {updateGroupSigningSession} = require('ln-service');
const {v1HashToSign} = require('p2tr');

const {keyFamily} = require('./../constants');

const defaultSighash = 0;
const expectedInputsCount = 1;
const vin = 0;

/** Cosign the cooperative sweep of a swap out with the client

  {
    key: <Client Claim Public Key Hex String>
    key_index: <Server Key Index Number>
    lnd: <Authenticated LND API Object>
    nonce: <Client Signing Session Nonce Hex String>
    output_script: <Swap Funding Output Script Hex String>
    psbt: <Unsigned Sweep PSBT Hex String>
    root_hash: <Swap Script Tree Root Hash Hex String>
    server_key: <Server Public Key Hex String>
    tokens: <Swap Tokens Number>
    transaction_id: <Swap Funding Transaction Id Hex String>
    transaction_vout: <Swap Funding Transaction Output Index Number>
  }

  @returns via cbk or Promise
  {
    nonce: <Server Signing Session Nonce Hex String>
    partial_signature: <Server Partial Signature Hex String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.key) {
          return cbk([400, 'ExpectedClientClaimKeyToSignSwapOutSweep']);
        }

        if (args.key_index === undefined) {
          return cbk([400, 'ExpectedServerKeyIndexToSignSwapOutSweep']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToSignSwapOutSweep']);
        }

        if (!args.nonce) {
          return cbk([400, 'ExpectedClientNonceToSignSwapOutSweep']);
        }

        if (!args.output_script) {
          return cbk([400, 'ExpectedSwapOutputScriptToSignSwapOutSweep']);
        }

        if (!args.psbt) {
          return cbk([400, 'ExpectedSweepPsbtToSignSwapOutSweep']);
        }

        if (!args.root_hash) {
          return cbk([400, 'ExpectedScriptRootHashToSignSwapOutSweep']);
        }

        if (!args.server_key) {
          return cbk([400, 'ExpectedServerKeyToSignSwapOutSweep']);
        }

        if (!args.tokens) {
          return cbk([400, 'ExpectedSwapTokensToSignSwapOutSweep']);
        }

        if (!args.transaction_id) {
          return cbk([400, 'ExpectedFundingTransactionIdToSignSwapOutSweep']);
        }

        if (args.transaction_vout === undefined) {
          return cbk([400, 'ExpectedFundingOutputIndexToSignSwapOutSweep']);
        }

        return cbk();
      },

      // Decode the sweep transaction out of the PSBT
      sweep: ['validate', asyncify(({}) => {
        try {
          decodePsbt({psbt: args.psbt});
        } catch (err) {
          throw [400, 'ExpectedValidSweepPsbtToSignSwapOutSweep', {err}];
        }

        const transaction = decodePsbt({psbt: args.psbt}).unsigned_transaction;

        const {inputs} = componentsOfTransaction({transaction});

        return {inputs, transaction};
      })],

      // Check that the sweep spends the swap funding
      checkSweep: ['sweep', ({sweep}, cbk) => {
        if (sweep.inputs.length !== expectedInputsCount) {
          return cbk([400, 'ExpectedSingleInputInSwapOutSweep']);
        }

        const [input] = sweep.inputs;

        if (input.id !== args.transaction_id) {
          return cbk([400, 'ExpectedSweepOfSwapFundingTransaction']);
        }

        if (input.vout !== args.transaction_vout) {
          return cbk([400, 'ExpectedSweepOfSwapFundingOutput']);
        }

        return cbk();
      }],

      // Hash to sign commits to the funding output being spent by the input
      hash: ['checkSweep', 'sweep', ({sweep}, cbk) => {
        const {hash} = v1HashToSign({
          vin,
          sighash: defaultSighash,
          spends: [{script: args.output_script, tokens: args.tokens}],
          transaction: sweep.transaction,
        });

        return cbk(null, hash);
      }],

      // Start the server side of the signing session
      begin: ['checkSweep', ({}, cbk) => {
        return beginGroupSigningSession({
          key_family: keyFamily,
          key_index: args.key_index,
          lnd: args.lnd,
          public_keys: [args.key, args.server_key],
          root_hash: args.root_hash,
        },
        cbk);
      }],

      // Make the partial signature using the client nonce
      sign: ['begin', 'hash', ({begin, hash}, cbk) => {
        return updateGroupSigningSession({
          hash,
          id: begin.id,
          lnd: args.lnd,
          nonces: [args.nonce],
        },
        cbk);
      }],

      // Final signature details
      signature: ['begin', 'sign', ({begin, sign}, cbk) => {
        return cbk(null, {
          nonce: begin.nonce,
          partial_signature: sign.signature,
        });
      }],
    },
    returnResult({reject, resolve, of: 'signature'}, cbk));
  });
};
