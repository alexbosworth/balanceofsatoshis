const {createHash} = require('crypto');

const asyncAuto = require('async/auto');
const {broadcastChainTransaction} = require('ln-service');
const {componentsOfTransaction} = require('@alexbosworth/blockchain');
const {createChainAddress} = require('ln-service');
const {getChainFeeRate} = require('ln-service');
const {getIdentity} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {idForTransaction} = require('@alexbosworth/blockchain');
const {outputScriptForAddress} = require('@alexbosworth/blockchain');
const {returnResult} = require('asyncjs-util');
const {scriptElementsAsScript} = require('@alexbosworth/blockchain');
const {signBytes} = require('ln-service');
const {sizeOfTransaction} = require('@alexbosworth/blockchain');
const {transactionFromComponents} = require('@alexbosworth/blockchain');

const getRawTransaction = require('./get_raw_transaction');

const {ceil} = Math;
const {concat} = Buffer;
const description = 'bos recover p2pk node identity key funds';
const estimatedSignatureSize = 73;
const format = 'p2wpkh';
const hashFlag = Buffer.from('01000000', 'hex');
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const inputSequence = 0;
const isHash = n => !!n && /^[0-9A-F]{64}$/i.test(n);
const locktime = 0;
const nodeIdentityKeyFamily = 6;
const nodeIdentityKeyIndex = 0;
const OP_CHECKSIG = 172;
const sha256 = n => createHash('sha256').update(n).digest().toString('hex');
const sigHashType = Buffer.from('01', 'hex');
const unsignedScript = '';
const version = 1;

/** Recover funds sent to a P2PK using the node identity key

  {
    id: <Transaction Id Hex String>
    lnd: <Authenticated LND API Object>
    request: <Request Function>
    vout: <Transaction Output Index Number>
  }

  @returns via cbk or Promise
  {
    recovering: <Recovering Tokens Number>
    recovering_to: <Recovering Funds to Address String>
    transaction_id: <Recovery Transaction Id Hex String>
  }
*/
module.exports = ({id, lnd, request, vout}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isHash(id)) {
          return cbk([400, 'ExpectedTxIdOfFundsSentToP2pkToRecoverFunds']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToRcoverP2pkFunds']);
        }

        if (!request) {
          return cbk([400, 'ExpectedRequestFunctionToRecoverP2pkFunds']);
        }

        if (vout === undefined) {
          return cbk([400, 'ExpectedTxVoutOfFundsSentToP2pkToRecoverFunds']);
        }

        return cbk();
      },

      // Get the chain fee rate
      getFee: ['validate', ({}, cbk) => getChainFeeRate({lnd}, cbk)],

      // Get the identity public key
      getIdentity: ['validate', ({}, cbk) => getIdentity({lnd}, cbk)],

      // Get the network name
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd}, cbk)],

      // Get the raw transaction
      getTx: ['getNetwork', ({getNetwork}, cbk) => {
        return getRawTransaction({
          id,
          request,
          network: getNetwork.network,
        },
        cbk);
      }],

      // Derive the transaction details
      output: ['getIdentity', 'getTx', ({getIdentity, getTx}, cbk) => {
        const {transaction} = getTx;

        // Make sure the tx data matches the input id
        if (idForTransaction({transaction}).id !== id) {
          return cbk([503, 'ExpectedTransactionIdToMatchTxDataHashToRecover']);
        }

        const {outputs} = componentsOfTransaction({transaction});

        const output = outputs[vout];

        // Make sure the output exists
        if (!output) {
          return cbk([503, 'ExpectedOutputAtVoutIndexToRecoverP2pkFunds']);
        }

        const identityKey = hexAsBuffer(getIdentity.public_key);

        const expected = scriptElementsAsScript({
          elements: [identityKey, OP_CHECKSIG],
        });

        // Make sure that the output pays to the node identity key
        if (output.script !== expected.script) {
          return cbk([503, 'ExpectedOutputPayingToNodeIdentityPublicKey']);
        }

        return cbk(null, {script: output.script, tokens: output.tokens});
      }],

      // Create a recovery address
      createAddress: ['output', ({}, cbk) => {
        return createChainAddress({format, lnd}, cbk);
      }],

      // Derive the output script of the recovery address
      recoveryScript: [
        'createAddress',
        'getNetwork',
        ({createAddress, getNetwork}, cbk) =>
      {
        try {
          const {script} = outputScriptForAddress({
            address: createAddress.address,
            network: getNetwork.network,
          });

          return cbk(null, {script});
        } catch (err) {
          return cbk([503, 'FailedToParseRecoveryAddress', {err}]);
        }
      }],

      // Derive the sweep output, less the amount needed to pay for chain fees
      sweep: [
        'getFee',
        'output',
        'recoveryScript',
        ({getFee, output, recoveryScript}, cbk) =>
      {
        const {script} = recoveryScript;

        const unsigned = transactionFromComponents({
          locktime,
          version,
          inputs: [{
            id,
            vout,
            script: unsignedScript,
            sequence: inputSequence,
          }],
          outputs: [{script, tokens: output.tokens}],
        });

        const {vsize} = sizeOfTransaction(unsigned);

        // Include the prospective signature in the tx total weight
        const vbytes = vsize + estimatedSignatureSize;

        // Reduce the sweep value by the amount needed to pay for chain fees
        const tokens = output.tokens - ceil(vbytes * getFee.tokens_per_vbyte);

        return cbk(null, {script, tokens});
      }],

      // Derive the preimage to use for signing
      preimage: ['output', 'sweep', ({output, sweep}, cbk) => {
        // When signing, the input to sign is set to the previous output script
        const {transaction} = transactionFromComponents({
          locktime,
          version,
          inputs: [{
            id,
            vout,
            script: output.script,
            sequence: inputSequence,
          }],
          outputs: [sweep],
        });

        // The bytes to sign are the tx itself plus the signature hash flag
        return cbk(null, concat([hexAsBuffer(transaction), hashFlag]));
      }],

      // Give the preimage to signer, hashed once - signBytes does 2nd SHA hash
      getSig: ['preimage', ({preimage}, cbk) => {
        return signBytes({
          lnd,
          key_family: nodeIdentityKeyFamily,
          key_index: nodeIdentityKeyIndex,
          preimage: sha256(preimage),
        },
        cbk);
      }],

      // Put together the signature with the transaction
      signedTx: ['getSig', 'sweep', ({getSig, sweep}, cbk) => {
        // A chain signature is the DER signature followed by the sighash type
        const signature = concat([hexAsBuffer(getSig.signature), sigHashType]);

        const {script} = scriptElementsAsScript({elements: [signature]});

        return cbk(null, transactionFromComponents({
          locktime,
          version,
          inputs: [{id, script, vout, sequence: inputSequence}],
          outputs: [sweep],
        }));
      }],

      // Broadcast the signed transaction
      publish: ['signedTx', ({signedTx}, cbk) => {
        return broadcastChainTransaction({
          description,
          lnd,
          transaction: signedTx.transaction,
        },
        cbk);
      }],

      // Final transaction details
      recovering: [
        'createAddress',
        'output',
        'signedTx',
        ({createAddress, output, signedTx}, cbk) =>
      {
        return cbk(null, {
          recovering: output.tokens,
          recovering_to: createAddress.address,
          transaction_id: idForTransaction(signedTx).id,
        });
      }],
    },
    returnResult({reject, resolve, of: 'recovering'}, cbk));
  });
};
