const {address} = require('bitcoinjs-lib');
const asyncAuto = require('async/auto');
const {networks} = require('bitcoinjs-lib');
const {payments} = require('bitcoinjs-lib');
const {returnResult} = require('asyncjs-util');
const {signTransaction} = require('ln-service');
const {Transaction} = require('bitcoinjs-lib');

const bufferAsHex = buffer => buffer.toString('hex');
const {concat} = Buffer;
const {fromBech32} = address;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const idAsHash = id => Buffer.from(id, 'hex').reverse();
const {p2pkh} = payments;
const refundTxSize = 110;
const sigHashAll = Buffer.from([Transaction.SIGHASH_ALL]);
const {toOutputScript} = address;
const transitKeyFamily = 805;

/** Make a refund transaction for balanced channel open transit funds

  {
    funded_tokens: <Tokens Sent to Transit Address Number>
    lnd: <Authenticated LND API Object>
    network: <Network Name String>
    refund_address: <Balanced Channel Open Refund On Chain Address String>
    refund_tokens: <Tokens To Refund Number>
    transit_address: <Balanced Channel Open Transit On Chain Address String>
    transit_key_index: <Transit Key Index Number>
    transit_public_key: <Transit Public Key Hex String>
    transaction_id: <Transaction Id Hex String>
    transaction_vout: <Transaction Output Index Number>
  }

  @returns via cbk or Promise
  {
    refund: <Fully Signed Refund Transaction Hex String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Accepted networks
      nets: cbk => {
        const nets = {
          btc: networks.bitcoin,
          btcregtest: networks.regtest,
          btctestnet: networks.testnet,
        };

        return cbk(null, nets);
      },

      // Check arguments
      validate: ['nets', ({nets}, cbk) => {
        if (!args.funded_tokens) {
          return cbk([400, 'ExpectedFundedTokensToGetBalancedChannelRefund']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToGetBalancedRefund']);
        }

        if (!nets[args.network]) {
          return cbk([400, 'ExpectedNetworkNameToGetBalancedChannelRefund']);
        }

        if (!args.refund_address) {
          return cbk([400, 'ExpectedRefundAddressToGetBalancedChannelRefund']);
        }

        if (!args.refund_tokens) {
          return cbk([400, 'ExpectedRefundTokensToGetBalancedChannelRefund']);
        }

        if (!args.transit_address) {
          return cbk([400, 'ExpectedTransitAddressToGetBalancedChanRefund']);
        }

        if (args.transit_key_index === undefined) {
          return cbk([400, 'ExpectedTransitKeyIndexToGetBalancedChanRefund']);
        }

        if (!args.transit_public_key) {
          return cbk([400, 'ExpectedTransitPublicKeyToGetBalancedChanRefund']);
        }

        if (!args.transaction_id) {
          return cbk([400, 'ExpectedTransactionIdToGetBalancedChannelRefund']);
        }

        if (args.transaction_vout === undefined) {
          return cbk([400, 'ExpectedTransactionVoutToGetBalancedChanRefund']);
        }

        return cbk();
      }],

      // Create the transaction to sign
      transactionToSign: ['nets', 'validate', ({nets}, cbk) => {
        const network = nets[args.network];
        const outpointHash = idAsHash(args.transaction_id);
        const tx = new Transaction();

        const refundOutput = toOutputScript(args.refund_address, network);

        tx.addInput(outpointHash, args.transaction_vout, Number());
        tx.addOutput(refundOutput, args.funded_tokens - refundTxSize);

        return cbk(null, tx);
      }],

      // Get the signature for the unsigned transaction
      getSignature: [
        'nets',
        'transactionToSign',
        ({nets, transactionToSign}, cbk) =>
      {
        const hash = fromBech32(args.transit_address).data;
        const network = nets[args.network];

        const outputScript = toOutputScript(args.transit_address, network);

        return signTransaction({
          lnd: args.lnd,
          inputs: [{
            key_family: transitKeyFamily,
            key_index: args.transit_key_index,
            output_script: bufferAsHex(outputScript),
            output_tokens: args.funded_tokens,
            sighash: Transaction.SIGHASH_ALL,
            vin: Number(),
            witness_script: bufferAsHex(p2pkh({hash}).output),
          }],
          transaction: transactionToSign.toHex(),
        },
        cbk);
      }],

      // Construct the fully signed refund transaction
      refundTransaction: [
        'getSignature',
        'transactionToSign',
        ({getSignature, transactionToSign}, cbk) =>
      {
        const [signature] = getSignature.signatures;

        const witnessStack = [
          concat([hexAsBuffer(signature), sigHashAll]),
          hexAsBuffer(args.transit_public_key),
        ];

        transactionToSign.setWitness(Number(), witnessStack);

        return cbk(null, {refund: transactionToSign.toHex()});
      }],
    },
    returnResult({reject, resolve, of: 'refundTransaction'}, cbk));
  });
};
