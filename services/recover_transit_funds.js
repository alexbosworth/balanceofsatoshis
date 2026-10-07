const {createHash} = require('crypto');

const asyncAuto = require('async/auto');
const asyncDetectSeries = require('async/detectSeries');
const {broadcastChainTransaction} = require('ln-service');
const {componentsOfTransaction} = require('@alexbosworth/blockchain');
const {createChainAddress} = require('ln-service');
const {decodeBech32Address} = require('@alexbosworth/blockchain');
const {getPublicKey} = require('ln-service');
const {getTransitRefund} = require('ln-sync');
const {idForTransaction} = require('@alexbosworth/blockchain');
const {outputScriptForAddress} = require('@alexbosworth/blockchain');
const {p2wpkhOutputScript} = require('@alexbosworth/blockchain');
const {returnResult} = require('asyncjs-util');

const bufferAsHex = buffer => buffer.toString('hex');
const defaultMaxIndex = 20000;
const description = 'BalancedChannelOpenFundsRecovery';
const family = 805;
const format = 'p2wpkh';
const hash160 = n => createHash('ripemd160').update(sha256(n)).digest();
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const notFoundIndex = -1;
const range = size => [...Array(size).keys()];
const sha256 = n => createHash('sha256').update(n).digest();

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
          decodeBech32Address({address: recover});

          outputScriptForAddress({network, address: recover});
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
          componentsOfTransaction({transaction: getTransaction});
        } catch (err) {
          return cbk([400, 'FailedToParseTransaction', {err}]);
        }

        return cbk();
      }],

      // Find the key index that matches the address
      findIndex: ['checkTransaction', ({}, cbk) => {
        const {script} = outputScriptForAddress({network, address: recover});

        return asyncDetectSeries(range(defaultMaxIndex), (index, cbk) => {
          return getPublicKey({family, index, lnd}, (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            const hash = hash160(hexAsBuffer(res.public_key));

            const output = p2wpkhOutputScript({hash}).script;

            return cbk(null, bufferAsHex(output) === script);
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
        const {script} = outputScriptForAddress({network, address: recover});

        const {outputs} = componentsOfTransaction({
          transaction: getTransaction,
        });

        const outputIndex = outputs.findIndex(out => out.script === script);

        if (outputIndex === notFoundIndex) {
          return cbk([400, 'AddressNotFoundInSuppliedTransaction']);
        }

        return getTransitRefund({
          lnd,
          network,
          funded_tokens: outputs[outputIndex].tokens,
          refund_address: createRefundAddress.address,
          transit_address: recover,
          transit_key_index: getTransitKey.index,
          transit_public_key: getTransitKey.public_key,
          transaction_id: idForTransaction({transaction: getTransaction}).id,
          transaction_vout: outputIndex,
        },
        cbk);
      }],

      // Broadcast the recovery transaction
      broadcast: ['recoveryTx', ({recoveryTx}, cbk) => {
        logger.info({
          recovery_tx_id: idForTransaction({transaction: recoveryTx.refund}).id,
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
