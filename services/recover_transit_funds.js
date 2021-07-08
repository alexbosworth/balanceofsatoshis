const {address} = require('bitcoinjs-lib');
const asyncAuto = require('async/auto');
const asyncDetectSeries = require('async/detectSeries');
const {broadcastChainTransaction} = require('ln-service');
const {createChainAddress} = require('ln-service');
const {getPublicKey} = require('ln-service');
const {networks} = require('bitcoinjs-lib');
const {payments} = require('bitcoinjs-lib');
const {returnResult} = require('asyncjs-util');
const {Transaction} = require('bitcoinjs-lib');

const getBalancedRefund = require('./get_balanced_refund');

const defaultMaxIndex = 20000;
const description = 'BalancedChannelOpenFundsRecovery';
const family = 805;
const format = 'p2wpkh';
const {fromBech32} = address;
const {fromHex} = Transaction;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const nets = {btc: networks.bitcoin, btctestnet: networks.testnet};
const notFoundIndex = -1;
const {p2wpkh} = payments;
const range = size => [...Array(size).keys()];
const {toOutputScript} = address;

/** Recover funds that were sent to a transit address by mistake

  {
    ask: <Ask Function>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    network: <Network Name String>
    recover: <Recover Funds Sent To Address String>
  }
*/
module.exports = ({ask, lnd, logger, network, recover}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!ask) {
          return cbk([400, 'ExpectedAskFunctionToRecoverTransitFunds']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToRecoverTransitFunds']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedWinstonLoggerToRecoverTransitFunds']);
        }

        if (!network) {
          return cbk([400, 'ExpectedNetworkNameToRecoverTransitFunds']);
        }

        if (!recover) {
          return cbk([400, 'ExpectedRecoverAddressToRecoverTransferFunds']);
        }

        try {
          fromBech32(recover);
        } catch (err) {
          return cbk([400, 'FailedToParseChainAddressToRecover', {err}]);
        }

        return cbk();
      },

      // Get the raw transaction
      getTransaction: ['validate', ({}, cbk) => {
        return ask({
          message: `Hex-encoded transaction paying to ${recover}`,
          name: 'transaction',
        },
        ({transaction}) => cbk(null, transaction));
      }],

      // Confirm that the transaction spends to the address to recover
      checkTransaction: ['getTransaction', ({getTransaction}, cbk) => {
        try {
          fromHex(getTransaction);
        } catch (err) {
          return cbk([400, 'FailedToParseTransaction', {err}]);
        }

        return cbk();
      }],

      // Find the key index that matches the address
      findIndex: ['checkTransaction', ({}, cbk) => {
        return asyncDetectSeries(range(defaultMaxIndex), (index, cbk) => {
          return getPublicKey({family, index, lnd}, (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            const pubkey = hexAsBuffer(res.public_key);

            const {address} = p2wpkh({pubkey, network: nets[network]});

            return cbk(null, address === recover);
          });
        },
        cbk);
      }],

      // Get the transit public key
      getTransitKey: ['findIndex', ({findIndex}, cbk) => {
        if (findIndex === undefined) {
          return cbk([400, 'FailedToFindKeyMatchingRecoverAddress']);
        }

        return getPublicKey({family, lnd, index: findIndex}, cbk);
      }],

      // Make a refund address
      createRefundAddress: ['checkTransaction', ({}, cbk) => {
        return createChainAddress({format, lnd}, cbk);
      }],

      // Form the recovery transaction
      recoveryTx: [
        'createRefundAddress',
        'getTransitKey',
        'getTransaction',
        ({createRefundAddress, getTransitKey, getTransaction}, cbk) =>
      {
        const outputScript = toOutputScript(recover, nets[network]);

        const outputIndex = fromHex(getTransaction).outs.findIndex(out => {
          return out.script.equals(outputScript);
        });

        if (outputIndex === notFoundIndex) {
          return cbk([400, 'AddressNotFoundInSuppliedTransaction']);
        }

        return getBalancedRefund({
          lnd,
          network,
          funded_tokens: fromHex(getTransaction).outs[outputIndex].value,
          refund_address: createRefundAddress.address,
          refund_tokens: fromHex(getTransaction).outs[outputIndex].value,
          transit_address: recover,
          transit_key_index: getTransitKey.index,
          transit_public_key: getTransitKey.public_key,
          transaction_id: fromHex(getTransaction).getId(),
          transaction_vout: outputIndex,
        },
        cbk);
      }],

      // Broadcast the recovery transaction
      broadcast: ['recoveryTx', ({recoveryTx}, cbk) => {
        logger.info({
          recovery_tx_id: fromHex(recoveryTx.refund).getId(),
          recovery_transaction: recoveryTx.refund,
        });

        return broadcastChainTransaction({
          description,
          lnd,
          transaction: recoveryTx.refund,
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
