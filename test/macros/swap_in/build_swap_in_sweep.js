const asyncAuto = require('async/auto');
const asyncify = require('async/asyncify');
const {createChainAddress} = require('ln-service');
const {createPsbt} = require('psbt');
const {extendPsbt} = require('psbt');
const {idForTransaction} = require('@alexbosworth/blockchain');
const {outputScriptForAddress} = require('@alexbosworth/blockchain');
const {returnResult} = require('asyncjs-util');
const {sizeOfTransaction} = require('@alexbosworth/blockchain');
const {transactionFromComponents} = require('@alexbosworth/blockchain');
const {v1HashToSign} = require('p2tr');

const beginSharedSessions = require('./begin_shared_sessions');
const {swapInSweepFeeRate} = require('./../constants');

const {ceil} = Math;
const defaultSighash = 0;
const emptyScript = '';
const format = 'p2tr';
const locktime = 0;
const placeholderSignature = '00'.repeat(64);
const sequence = 0;
const version = 2;

/** Build the sweep of the deposits of a paid swap in

  {
    lnd: <Authenticated LND API Object>
    network: <Network Name String>
    swap: <Swap In Object>
  }

  @returns via cbk or Promise
  {
    hashes: [<Deposit Input Hash To Sign Hex String>]
    id: <Sweep Transaction Id Hex String>
    inputs: [{
      id: <Deposit Transaction Id Hex String>
      script: <Empty Script Hex String>
      sequence: <Sequence Number>
      vout: <Deposit Transaction Output Index Number>
    }]
    outputs: [{
      script: <Output Script Hex String>
      tokens: <Output Tokens Number>
    }]
    prevouts: [{
      script: <Deposit Output Script Hex String>
      tokens: <Deposit Tokens Number>
      transaction_id: <Deposit Transaction Id Hex String>
      transaction_vout: <Deposit Transaction Output Index Number>
    }]
    psbt: <Unsigned Sweep PSBT Hex String>
    sessions: [{
      id: <Server Session Id Hex String>
      nonce: <Server Session Nonce Hex String>
    }]
  }
*/
module.exports = ({lnd, network, swap}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedLndToBuildSwapInSweep']);
        }

        if (!network) {
          return cbk([400, 'ExpectedNetworkNameToBuildSwapInSweep']);
        }

        if (!swap) {
          return cbk([400, 'ExpectedSwapToBuildSwapInSweep']);
        }

        return cbk();
      },

      // Make an address for the server to receive the swapped tokens
      createAddress: ['validate', ({}, cbk) => {
        return createChainAddress({format, lnd}, cbk);
      }],

      // Begin a signing session for every deposit
      beginSessions: ['validate', ({}, cbk) => {
        return beginSharedSessions({lnd, deposits: swap.deposits}, cbk);
      }],

      // Assemble the unsigned sweep
      unsigned: ['createAddress', asyncify(({createAddress}) => {
        const [{address}] = swap.deposits;

        const inputs = swap.deposits.map(deposit => ({
          sequence,
          id: deposit.transaction_id,
          script: emptyScript,
          vout: deposit.transaction_vout,
        }));

        const {script} = outputScriptForAddress({
          network,
          address: createAddress.address,
        });

        // Swap tokens go to the server and change back to the shared address
        const outputs = [{script, tokens: swap.tokens}];

        if (!!swap.change) {
          outputs.push({script: address.output_script, tokens: swap.change});
        }

        // Estimate the size of the sweep with placeholder signatures
        const {transaction} = transactionFromComponents({
          locktime,
          outputs,
          version,
          inputs: inputs.map(input => ({
            id: input.id,
            script: input.script,
            sequence: input.sequence,
            vout: input.vout,
            witness: [placeholderSignature],
          })),
        });

        const {vsize} = sizeOfTransaction({transaction});

        const fee = ceil(vsize * swapInSweepFeeRate);

        // The fee comes out of the swapped tokens
        const [serverOutput] = outputs;

        serverOutput.tokens -= fee;

        return {inputs, outputs};
      })],

      // Sweep transaction and hashes to sign
      sweep: [
        'beginSessions',
        'unsigned',
        asyncify(({beginSessions, unsigned}) =>
      {
        const {inputs, outputs} = unsigned;

        const {transaction} = transactionFromComponents({
          inputs,
          locktime,
          outputs,
          version,
        });

        const prevouts = swap.deposits.map(deposit => ({
          script: deposit.address.output_script,
          tokens: deposit.tokens,
          transaction_id: deposit.transaction_id,
          transaction_vout: deposit.transaction_vout,
        }));

        const spends = prevouts.map(({script, tokens}) => ({script, tokens}));

        const {psbt} = extendPsbt({
          inputs: spends.map(({script, tokens}) => ({
            witness_utxo: {tokens, script_pub: script},
          })),
          psbt: createPsbt({
            outputs,
            version,
            utxos: inputs.map(({id, vout}) => ({id, sequence, vout})),
          }).psbt,
        });

        return {
          inputs,
          outputs,
          prevouts,
          psbt,
          transaction,
          hashes: inputs.map((input, vin) => v1HashToSign({
            spends,
            transaction,
            vin,
            sighash: defaultSighash,
          }).hash),
          id: idForTransaction({transaction}).id,
          sessions: beginSessions.sessions,
        };
      })],
    },
    returnResult({reject, resolve, of: 'sweep'}, cbk));
  });
};
