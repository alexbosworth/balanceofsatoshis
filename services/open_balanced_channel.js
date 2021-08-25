const asyncAuto = require('async/auto');
const asyncDetectSeries = require('async/detectSeries');
const asyncEachSeries = require('async/eachSeries');
const asyncRetry = require('async/retry');
const {broadcastChainTransaction} = require('ln-service');
const {createChainAddress} = require('ln-service');
const {formatTokens} = require('ln-sync');
const {getNodeAlias} = require('ln-sync');
const {getInvoices} = require('ln-service');
const {getPayments} = require('ln-service');
const {getPublicKey} = require('ln-service');
const moment = require('moment');
const {networks} = require('bitcoinjs-lib');
const {payments} = require('bitcoinjs-lib');
const {returnResult} = require('asyncjs-util');

const acceptBalancedChannel = require('./accept_balanced_channel');
const getBalancedOpens = require('./get_balanced_opens');
const getNetwork = require('./../network/get_network');
const initiateBalancedChannel = require('./initiate_balanced_channel');
const recoverTransitFunds = require('./recover_transit_funds');

const bufferAsHex = buffer => buffer.toString('hex');
const familyMultiSig = 0;
const familyTemporary = 805;
const format = 'p2wpkh';
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const interval = 1000 * 15;
const isOldNodeVersion = () => !Buffer.alloc(0).writeBigUInt64BE;
const minErrorCount = 4;
const networkMainnet = 'btc';
const networkTestnet = 'btctestnet';
const {p2wpkh} = payments;
const times = 60;

/** Open a balanced channel

  {
    [after]: <Ignore Requests Before ISO 8601 Date String>
    ask: <Ask Function>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    [recover]: <Recover Funds Sent To Address String>
  }

  @returns via cbk or Promise
*/
module.exports = ({after, ask, lnd, logger, recover}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!ask) {
          return cbk([400, 'ExpectedInterrogationFunctionToOpenBalancedChan']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToOpenBalancedChan']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedWinstonLoggerToOpenBalancedChannel']);
        }

        if (isOldNodeVersion()) {
          return cbk([400, 'ExpectedLaterNodeJsVersionToOpenBalancedChan']);
        }

        return cbk();
      },

      // Get the network name
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd}, cbk)],

      // Determine the bitcoinjs network
      network: ['getNetwork', ({getNetwork}, cbk) => {
        switch (getNetwork.network) {
        case networkMainnet:
          return cbk(null, networks.bitcoin);

        case networkTestnet:
          return cbk(null, networks.testnet);

        default:
          return cbk([400, 'UnsupportedNetworkForBalanceChannelOpen']);
        }
      }],

      // Recover funds sent to an address
      recover: ['getNetwork', ({getNetwork}, cbk) => {
        // Exit early when not in a recovery scenario
        if (!recover) {
          return cbk();
        }

        return recoverTransitFunds({
          ask,
          lnd,
          logger,
          recover,
          network: getNetwork.network,
        },
        err => {
          if (!!err) {
            return cbk(err);
          }

          return cbk([400, 'BalancedChannelRecoveryComplete']);
        });
      }],

      // Make a refund address for if things go wrong
      createRefundAddress: ['recover', ({}, cbk) => {
        return createChainAddress({format, lnd}, cbk);
      }],

      // Get the set of open requests
      getOpenRequests: ['recover', ({}, cbk) => getBalancedOpens({lnd}, cbk)],

      // Confirm an incoming channel request
      confirmContinue: ['getOpenRequests', ({getOpenRequests}, cbk) => {
        return asyncDetectSeries(getOpenRequests.incoming, (request, cbk) => {
          // Exit early when this is an older request
          if (!!after && request.proposed_at < after) {
            return cbk();
          }

          const [got] = [request.proposed_at, new Date().toISOString()].sort();

          const at = moment(got).fromNow();

          const id = request.partner_public_key;
          const action = `Balanced channel request ${at} from`;
          const capacity = formatTokens({tokens: request.capacity}).display;
          const fee = `${request.fee_rate}/vbyte chain fee rate`;

          return getNodeAlias({id, lnd}, (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            const key = `${res.alias} ${request.partner_public_key}`.trim();

            const confirmIncomingChannel = {
              message: `${action} ${key}:\n- ${capacity} channel at ${fee}?`,
              name: 'accept',
              type: 'confirm',
            };

            return ask(confirmIncomingChannel, ({accept}) => cbk(null, accept));
          });
        },
        cbk);
      }],

      // Specify a peer to open a new channel with
      askForKey: ['confirmContinue', ({confirmContinue}, cbk) => {
        // Exit early when this is a continuation of a balanced channel open
        if (!!confirmContinue) {
          return cbk();
        }

        const initiateChannel = {
          message: 'Public key of the node to request a balanced open with?',
          name: 'key',
        };

        return ask(initiateChannel, ({key}) => cbk(null, key));
      }],

      // Generate a transitive key to fund one side of the channel
      generateTransitKey: ['askForKey', ({}, cbk) => {
        return getPublicKey({lnd, family: familyTemporary}, cbk);
      }],

      // Generate the funding output multi-sig key that will receive all funds
      generateMultiSigKey: ['askForKey', ({}, cbk) => {
        return getPublicKey({lnd, family: familyMultiSig}, cbk);
      }],

      // Derive an address from the generated key for the transitive funds
      transitAddress: [
        'confirmContinue',
        'generateTransitKey',
        'network',
        ({confirmContinue, generateTransitKey, network}, cbk) =>
      {
        const pubkey = hexAsBuffer(generateTransitKey.public_key);

        const {address, hash} = p2wpkh({network, pubkey});

        return cbk(null, {address, hash: bufferAsHex(hash)});
      }],

      // Initiate a new balanced channel request
      initiate: [
        'askForKey',
        'confirmContinue',
        'createRefundAddress',
        'generateMultiSigKey',
        'generateTransitKey',
        'getNetwork',
        'transitAddress',
        ({
          askForKey,
          confirmContinue,
          createRefundAddress,
          generateMultiSigKey,
          generateTransitKey,
          getNetwork,
          transitAddress,
        },
        cbk) =>
      {
        // Exit early when continuing an open request
        if (!!confirmContinue) {
          return cbk();
        }

        return initiateBalancedChannel({
          ask,
          lnd,
          logger,
          multisig_key_index: generateMultiSigKey.index,
          network: getNetwork.network,
          partner_public_key: askForKey,
          refund_address: createRefundAddress.address,
          transit_address: transitAddress.address,
          transit_key_index: generateTransitKey.index,
        },
        cbk);
      }],

      // Continue a pre-existing balanced channel request
      accept: [
        'confirmContinue',
        'createRefundAddress',
        'generateMultiSigKey',
        'generateTransitKey',
        'getNetwork',
        'transitAddress',
        ({
          confirmContinue,
          createRefundAddress,
          generateMultiSigKey,
          generateTransitKey,
          getNetwork,
          transitAddress,
        },
        cbk) =>
      {
        // Exit early when this is not a continuation of an existing open
        if (!confirmContinue) {
          return cbk();
        }

        return acceptBalancedChannel({
          ask,
          lnd,
          logger,
          accept_request: confirmContinue.accept_request,
          capacity: confirmContinue.capacity,
          fee_rate: confirmContinue.fee_rate,
          multisig_key_index: generateMultiSigKey.index,
          multisig_public_key: generateMultiSigKey.public_key,
          network: getNetwork.network,
          partner_public_key: confirmContinue.partner_public_key,
          refund_address: createRefundAddress.address,
          remote_multisig_key: confirmContinue.remote_multisig_key,
          remote_tx_id: confirmContinue.remote_tx_id,
          remote_tx_vout: confirmContinue.remote_tx_vout,
          transit_address: transitAddress.address,
          transit_key_index: generateTransitKey.index,
          transit_public_key: generateTransitKey.public_key,
        },
        cbk);
      }],

      // Broadcast channel transactions until the channel confirms
      broadcastTransactions: [
        'accept',
        'initiate',
        ({accept, initiate}, cbk) =>
      {
        const broadcastErrors = [];
        const ready = accept || initiate;

        logger.info({
          channel_transaction_id: ready.transaction_id,
          channel_transaction_vout: ready.transaction_vout,
          transactions_to_broadcast: ready.transactions
        });

        return asyncEachSeries(ready.transactions, (transaction, cbk) => {
          return asyncRetry({interval, times}, cbk => {
            return broadcastChainTransaction({lnd, transaction}, (err, r) => {
              if (!!err) {
                broadcastErrors.push(err);
              }

              // Exit early when there are not many errors yet
              if (!!err && broadcastErrors.length < minErrorCount) {
                return cbk(err);
              }

              // Exit early when there is an error broadcasting the tx
              if (!!err) {
                logger.error({err});

                return cbk(err);
              }

              logger.info({broadcast: r.id});

              return setTimeout(cbk, interval);
            });
          },
          cbk);
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
