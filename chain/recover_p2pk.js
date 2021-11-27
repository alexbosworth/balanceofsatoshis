const {createHash} = require('crypto');

const asyncAuto = require('async/auto');
const bitcoinjsLib = require('bitcoinjs-lib');
const {broadcastChainTransaction} = require('ln-service');
const {createChainAddress} = require('ln-service');
const {decode} = require('bip66');
const {getChainFeeRate} = require('ln-service');
const {getIdentity} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {returnResult} = require('asyncjs-util');
const {signBytes} = require('ln-service');

const getRawTransaction = require('./get_raw_transaction');

const {ceil} = Math;
const {compile} = bitcoinjsLib.script;
const {concat} = Buffer;
const description = 'bos recover p2pk node identity key funds';
const {encode} = bitcoinjsLib.script.signature;
const estimatedSignatureSize = 73;
const format = 'p2wpkh';
const {fromHex} = bitcoinjsLib.Transaction;
const hashFlag = Buffer.from('01000000', 'hex');
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const inputIndex = 0;
const inputSequence = 0;
const isHash = n => !!n && /^[0-9A-F]{64}$/i.test(n);
const networkNames = {btc: 'bitcoin', btctestnet: 'testnet'};
const {networks} = bitcoinjsLib;
const nodeIdentityKeyFamily = 6;
const nodeIdentityKeyIndex = 0;
const OP_CHECKSIG = 172;
const sha256 = n => createHash('sha256').update(n).digest().toString('hex');
const slicePoint = r => r.length === 33 ? r.slice(1) : r;
const {toOutputScript} = bitcoinjsLib.address;
const {Transaction} = bitcoinjsLib;

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
        const tx = fromHex(getTx.transaction);

        // Make sure the tx data matches the input id
        if (tx.getId() !== id) {
          return cbk([503, 'ExpectedTransactionIdToMatchTxDataHashToRecover']);
        }

        const output = tx.outs[vout];

        // Make sure the output exists
        if (!output) {
          return cbk([503, 'ExpectedOutputAtVoutIndexToRecoverP2pkFunds']);
        }

        const identityKey = hexAsBuffer(getIdentity.public_key);

        const expectedScript = compile([identityKey, OP_CHECKSIG]);

        // Make sure that the output pays to the node identity key
        if (!output.script.equals(expectedScript)) {
          return cbk([503, 'ExpectedOutputPayingToNodeIdentityPublicKey']);
        }

        return cbk(null, {script: output.script, tokens: output.value});
      }],

      // Create a recovery address
      createAddress: ['output', ({}, cbk) => {
        return createChainAddress({format, lnd}, cbk);
      }],

      // Make the transaction to sign
      txToSign: [
        'createAddress',
        'getFee',
        'getNetwork',
        'output',
        ({createAddress, getFee, getNetwork, output}, cbk) =>
      {
        const network = networks[networkNames[getNetwork.network]];
        const tx = new Transaction();

        const scriptPubKey = toOutputScript(createAddress.address, network);

        tx.addInput(hexAsBuffer(id).reverse(), inputIndex, inputSequence);
        tx.addOutput(scriptPubKey, output.tokens);

        // There is only one output on the sweep transaction
        const [out] = tx.outs;

        // Include the prospective signature in the tx total weight
        const vbytes = tx.virtualSize() + estimatedSignatureSize;

        // Reduce the sweep value by the amount needed to pay for chain fees
        out.value -= ceil(vbytes * getFee.tokens_per_vbyte);

        return cbk(null, tx);
      }],

      // Derive the preimage to use for signing
      preimage: ['output', 'txToSign', ({output, txToSign}, cbk) => {
        const cloneTx = txToSign.clone();

        const [input] = cloneTx.ins;

        // When signing, the input to sign is set to the previous output script
        input.script = output.script;

        // The bytes to sign are the tx itself plus the signature hash flag
        return cbk(null, concat([cloneTx.toBuffer(), hashFlag]));
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
      signedTx: ['getSig', 'txToSign', ({getSig, txToSign}, cbk) => {
        const {r, s} = decode(hexAsBuffer(getSig.signature));

        const rValue = slicePoint(r);

        // Convert the signature from sign bytes to a chain signature
        const scriptSig = encode(concat([rValue, s]), Transaction.SIGHASH_ALL);

        txToSign.setInputScript(inputIndex, compile([scriptSig]));

        return cbk(null, txToSign);
      }],

      // Broadcast the signed transaction
      publish: ['signedTx', ({signedTx}, cbk) => {
        return broadcastChainTransaction({
          description,
          lnd,
          transaction: signedTx.toHex(),
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
          transaction_id: signedTx.getId(),
        });
      }],
    },
    returnResult({reject, resolve, of: 'recovering'}, cbk));
  });
};
