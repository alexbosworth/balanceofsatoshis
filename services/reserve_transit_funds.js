const {address} = require('bitcoinjs-lib');
const asyncAuto = require('async/auto');
const {createChainAddress} = require('lightning');
const {getFundedTransaction} = require('goldengate');
const {getNetwork} = require('ln-sync');
const {getPublicKey} = require('lightning');
const {getTransitRefund} = require('ln-sync');
const {networks} = require('bitcoinjs-lib');
const {payments} = require('bitcoinjs-lib');
const {returnResult} = require('asyncjs-util');
const {Transaction} = require('bitcoinjs-lib');

const bufferAsHex = buffer => buffer.toString('hex');
const familyTemporary = 805;
const {fromBech32} = address;
const {fromHex} = Transaction;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const minimum = 294;
const notFoundIndex = -1;
const {p2pkh} = payments;
const {p2wpkh} = payments;
const {toOutputScript} = address;

/** Get on-chain funding and a refund

  {
    ask: <Ask Function>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    [rate]: <Chain Fee Rate Tokens Per VByte Number>
    tokens: <Fund Tokens Number>
  }

  @returns via cbk or Promise
  {
    address: <Transit Address String>
    id: <Transaction Id Hex String>
    index: <Transit Public Key Index Number>
    [inputs]: [{
      [lock_expires_at]: <UTXO Lock Expires At ISO 8601 Date String>
      [lock_id]: <UTXO Lock Id Hex String>
      transaction_id: <Transaction Hex Id String>
      transaction_vout: <Transaction Output Index Number>
    }]
    key: <Transit Key Public Key Hex String>
    output: <Transit Output Script Hex String>
    [psbt]: <Transaction As Finalized PSBT Hex String>
    refund: <Refund Transaction Hex String>
    script: <Transit Signing Witness Script Hex String>
    transaction: <Raw Transaction Hex String>
    vout: <Funds Reserved At Output Index Number>
  }
*/
module.exports = ({ask, lnd, logger, rate, tokens}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!ask) {
          return cbk([400, 'ExpectedAskFunctionToReserveTransitFunds']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToReserveTransitFunds']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedWinstonLoggerToReserveTransitFunds']);
        }

        if (!tokens) {
          return cbk([400, 'ExpectedTokensToReserveToReserveTransitFunds']);
        }

        if (tokens < minimum) {
          return cbk([400, 'ExpectedLargerAdditionToReserveTransitFunds']);
        }

        return cbk();
      },

      // Get the network name
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd}, cbk)],

      // Setup a new transit key for capacity increase
      getTransitKey: ['getNetwork', ({getNetwork}, cbk) => {
        if (!getNetwork.bitcoinjs) {
          return cbk([400, 'ExpectedKnownNetworkToReserveTransitFunds']);
        }

        return getPublicKey({lnd, family: familyTemporary}, cbk);
      }],

      // Derive a transit address from the transit key
      transit: [
        'getNetwork',
        'getTransitKey',
        ({getNetwork, getTransitKey}, cbk) =>
      {
        return cbk(null, p2wpkh({
          network: networks[getNetwork.bitcoinjs],
          pubkey: hexAsBuffer(getTransitKey.public_key),
        }));
      }],

      // Get funding to the transit key
      getFunding: ['transit', ({transit}, cbk) => {
        return getFundedTransaction({
          ask,
          lnd,
          logger,
          chain_fee_tokens_per_vbyte: rate || undefined,
          outputs: [{tokens, address: transit.address}],
        },
        cbk);
      }],

      // Create a refund address
      createRefund: ['getFunding', ({}, cbk) => {
        return createChainAddress({lnd}, cbk);
      }],

      // Confirm the funding transaction output
      transactionVout: [
        'getFunding',
        'transit',
        ({getFunding, transit}, cbk) =>
      {
        const {transaction} = getFunding;

        if (!transaction) {
          return cbk([400, 'ExpectedFundedTransactionToReserveTransitFunds']);
        }

        const vout = fromHex(transaction).outs.findIndex(({script}) => {
          return script.equals(transit.output);
        });

        if (vout === notFoundIndex) {
          return cbk([400, 'ExpectedTransitTxOutputPayingToTransitAddress']);
        }

        // The transaction must have the output sending to the address
        if (fromHex(transaction).outs[vout].value !== tokens) {
          return cbk([
            400,
            'UnexpectedFundingAmountPayingToTransitAddress',
            {expected: tokens},
          ]);
        }

        return cbk(null, vout);
      }],

      // Get a refund transaction for the transit funds
      getRefund: [
        'createRefund',
        'getFunding',
        'getNetwork',
        'getTransitKey',
        'transit',
        'transactionVout',
        ({
          createRefund,
          getFunding,
          getNetwork,
          getTransitKey,
          transit,
          transactionVout,
        },
        cbk) =>
      {
        return getTransitRefund({
          lnd,
          funded_tokens: tokens,
          network: getNetwork.network,
          refund_address: createRefund.address,
          transit_address: transit.address,
          transit_key_index: getTransitKey.index,
          transit_public_key: getTransitKey.public_key,
          transaction_id: getFunding.id,
          transaction_vout: transactionVout,
        },
        cbk);
      }],

      // Final funding details, including a refund paying out of transit
      funding: [
        'getFunding',
        'getNetwork',
        'getRefund',
        'getTransitKey',
        'transactionVout',
        'transit',
        ({
          getFunding,
          getNetwork,
          getRefund,
          getTransitKey,
          transactionVout,
          transit,
        },
        cbk) =>
      {
        const network = networks[getNetwork.bitcoinjs];

        const {data} = fromBech32(transit.address, network);

        return cbk(null, {
          address: transit.address,
          id: getFunding.id,
          index: getTransitKey.index,
          inputs: getFunding.inputs,
          key: getTransitKey.public_key,
          output: bufferAsHex(toOutputScript(transit.address, network)),
          psbt: getFunding.psbt,
          refund: getRefund.refund,
          script: bufferAsHex(p2pkh({hash: data}).output),
          transaction: getFunding.transaction,
          vout: transactionVout,
        });
      }],
    },
    returnResult({reject, resolve, of: 'funding'}, cbk));
  });
};
