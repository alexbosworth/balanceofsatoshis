const asyncAuto = require('async/auto');
const {componentsOfTransaction} = require('@alexbosworth/blockchain');
const {connectPeer} = require('ln-sync');
const {formatTokens} = require('ln-sync');
const {getPeers} = require('ln-service');
const {getPublicKey} = require('ln-service');
const {idForTransaction} = require('@alexbosworth/blockchain');
const {maintainUtxoLocks} = require('ln-sync');
const {makePeerRequest} = require('paid-services');
const {p2msScript} = require('@alexbosworth/blockchain');
const {p2wshOutputScript} = require('@alexbosworth/blockchain');
const {parsePaymentRequest} = require('ln-service');
const {pay} = require('ln-service');
const {prepareForChannelProposal} = require('ln-service');
const {reserveTransitFunds} = require('ln-sync');
const {returnResult} = require('asyncjs-util');
const {signTransaction} = require('ln-service');
const {transactionFromComponents} = require('@alexbosworth/blockchain');
const {waitForPendingOpen} = require('ln-sync');

const {balancedChannelKeyTypes} = require('./service_key_types');

const acceptRequestIdType = '0';
const bufferAsHex = buffer => buffer.toString('hex');
const defaultMaxFeeMtokens = '9000';
const fundingAmount = (capacity, rate) => (capacity + (190 * rate)) / 2;
const fundingFee = rate => Math.ceil(190 / 2 * rate);
const giveTokens = capacity => Math.ceil(capacity / 2);
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const idAsHash = id => Buffer.from(id, 'hex').reverse();
const inputsOf = tx => componentsOfTransaction({transaction: tx}).inputs;
const interval = 1000 * 15;
const {isArray} = Array;
const isSameId = (a, b) => a.toLowerCase() === b.toLowerCase();
const multiSigKeyFamily = 0;
const networkBitcoin = 'btc';
const networkRegtest = 'btcregtest';
const networkTestnet = 'btctestnet';
const numAsHex = num => num.toString(16);
const paddedHexNumber = n => n.length % 2 ? `0${n}` : n;
const p2pTimeoutMs = 1000 * 90;
const relockIntervalMs = 1000 * 20;
const sighashAll = 1;
const times = 60 * 6;
const transitKeyFamily = 805;
const txLocktime = 0;
const txVersion = 1;

/** Accept a balanced channel

  {
    accept_request: <Accept Balanced Request BOLT 11 Payment Request String>
    ask: <Ask Function>
    capacity: <Channel Capacity Tokens Number>
    fee_rate: <Chain Fee Rate Tokens Per VByte Number>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    multisig_key_index: <MultiSig Key Index Number>
    network: <Network Name String>
    partner_public_key: <Partner Public Key Hex String>
    remote_multisig_key: <Remote MultiSig Public Key Hex String>
    remote_tx_id: <Remote Transit Transaction Id Hex String>
    remote_tx_vout: <Remote Transit Transaction Output Index Number>
  }

  @returns via cbk or Promise
  {
    transaction_id: <Funding Transaction Id Hex String>
    transaction_vout: <Funding Transaction Output Index Number>
    transactions: [<Hex Transaction String>]
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.accept_request) {
          return cbk([400, 'ExpectedAcceptRequestToAcceptBalancedChannel']);
        }

        if (!args.ask) {
          return cbk([400, 'ExpectedAskFunctionToAcceptBalancedChannel']);
        }

        if (!args.capacity) {
          return cbk([400, 'ExpectedCapacityToAcceptBalancedChannel']);
        }

        if (!args.fee_rate) {
          return cbk([400, 'ExpectedChainFeeRateToAcceptBalancedChannel']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToAcceptBalancedChannel']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedWinstonLoggerToAcceptBalancedChannel']);
        }

        if (args.multisig_key_index === undefined) {
          return cbk([400, 'ExpectedMultiSigKeyIndexToAcceptBalancedChannel']);
        }

        if (!args.network) {
          return cbk([400, 'ExpectedNetworkNameToAcceptBalancedChannel']);
        }

        if (!args.remote_multisig_key) {
          return cbk([400, 'ExpectedRemoteMultiSigPublicKeyToAcceptChannel']);
        }

        if (!args.partner_public_key) {
          return cbk([400, 'ExpectedPartnerPublicKeyToAcceptBalancedChannel']);
        }

        return cbk();
      },

      // Connect to the peer
      connect: ['validate', ({}, cbk) => {
        return connectPeer({id: args.partner_public_key, lnd: args.lnd}, cbk);
      }],

      // Derive the multisig 2:2 key
      getMultiSigKey: ['validate', ({}, cbk) => {
        return getPublicKey({
          family: multiSigKeyFamily,
          index: args.multisig_key_index,
          lnd: args.lnd,
        },
        cbk);
      }],

      // Make sure the network is supported
      network: ['validate', ({}, cbk) => {
        switch (args.network) {
        case networkBitcoin:
        case networkRegtest:
        case networkTestnet:
          return cbk(null, args.network);

        default:
          return cbk([400, 'UnsupportedNetworkForAcceptingBalancedChannel']);
        }
      }],

      // Get connected peers
      getPeers: ['connect', ({}, cbk) => getPeers({lnd: args.lnd}, cbk)],

      // Make sure that the requesting peer is connected
      confirmPeer: ['getPeers', ({getPeers}, cbk) => {
        const connected = getPeers.peers.map(n => n.public_key);

        if (!connected.includes(args.partner_public_key)) {
          return cbk([
            400,
            'ExpectedPeerConnectedToAcceptBalancedChannel',
            {key: args.partner_public_key},
          ]);
        }

        return cbk();
      }],

      // Ask for a signed transit transaction
      askForTransit: ['confirmPeer', ({}, cbk) => {
        return reserveTransitFunds({
          ask: args.ask,
          lnd: args.lnd,
          logger: args.logger,
          rate: args.fee_rate,
          tokens: fundingAmount(args.capacity, args.fee_rate),
        },
        cbk);
      }],

      // Create the funding transaction to sign with the transit key
      fundingTx: [
        'askForTransit',
        'getMultiSigKey',
        ({askForTransit, getMultiSigKey}, cbk) =>
      {
        if (!!askForTransit.inputs) {
          // Maintain a lock on the UTXOs until the tx confirms
          maintainUtxoLocks({
            id: askForTransit.id,
            inputs: askForTransit.inputs,
            interval: relockIntervalMs,
            lnd: args.lnd,
          },
          () => {});
        }

        args.logger.info({refund_transaction: askForTransit.refund});

        const keys = [getMultiSigKey.public_key, args.remote_multisig_key];

        const redeem = p2msScript({
          keys: keys.sort().map(hexAsBuffer),
          required: keys.length,
        });

        const remoteFunding = {
          id: args.remote_tx_id,
          vout: args.remote_tx_vout,
        };

        const {script} = p2wshOutputScript({hash: redeem.hash});

        // The inputs to the funding tx are the transit transactions
        const inputs = [askForTransit, remoteFunding].map(({id, vout}) => ({
          id,
          vout,
          script: String(),
          sequence: Number(),
        }));

        // Sort the inputs for BIP 69 deterministic encoding
        inputs.sort((a, b) => {
          const aHash = bufferAsHex(idAsHash(a.id));
          const bHash = bufferAsHex(idAsHash(b.id));

          return aHash.localeCompare(bHash) || a.vout - b.vout;
        });

        // The output to the channel funding is capacity paid to the 2:2 addr
        const outputs = [{script: bufferAsHex(script), tokens: args.capacity}];

        const {transaction} = transactionFromComponents({
          inputs,
          outputs,
          locktime: txLocktime,
          version: txVersion,
        });

        const {id} = idForTransaction({transaction});

        args.logger.info({
          funding_tx_id: id,
          waiting_for_full_channel_proposal: true,
        });

        return cbk(null, {
          transaction,
          pending_channel_id: bufferAsHex(redeem.hash),
          transaction_id: id,
          transaction_vout: outputs.findIndex(n => {
            return n.script === bufferAsHex(script);
          }),
        });
      }],

      // Sign the funding transaction spending the transit funds
      signFunding: [
        'askForTransit',
        'fundingTx',
        'network',
        ({askForTransit, fundingTx}, cbk) =>
      {
        const inputs = inputsOf(fundingTx.transaction);
        const tokens = giveTokens(args.capacity) + fundingFee(args.fee_rate);

        // Find the input index where the funding outpoint is being spent
        const fundingVin = inputs.findIndex(input => {
          if (input.vout !== askForTransit.vout) {
            return false;
          }

          return isSameId(input.id, askForTransit.id);
        });

        // Sign the channel funding transaction
        return signTransaction({
          lnd: args.lnd,
          inputs: [{
            key_family: transitKeyFamily,
            key_index: askForTransit.index,
            output_script: askForTransit.output,
            output_tokens: tokens,
            sighash: sighashAll,
            vin: fundingVin,
            witness_script: askForTransit.script,
          }],
          transaction: fundingTx.transaction,
        },
        cbk);
      }],

      // Prepare for an incoming channel
      prepareForProposal: ['fundingTx', 'signFunding', ({fundingTx}, cbk) => {
        return prepareForChannelProposal({
          id: fundingTx.pending_channel_id,
          key_index: args.multisig_key_index,
          lnd: args.lnd,
          remote_key: args.remote_multisig_key,
          transaction_id: fundingTx.transaction_id,
          transaction_vout: fundingTx.transaction_vout,
        },
        cbk);
      }],

      // Derive the accept records to communicate accept details
      acceptRecords: [
        'askForTransit',
        'getMultiSigKey',
        'signFunding',
        ({askForTransit, getMultiSigKey, signFunding}, cbk) =>
      {
        const [fundingSignature] = signFunding.signatures;

        return cbk(null, [
          {
            type: balancedChannelKeyTypes.multisig_public_key,
            value: getMultiSigKey.public_key,
          },
          {
            type: balancedChannelKeyTypes.transit_tx_id,
            value: askForTransit.id,
          },
          {
            type: balancedChannelKeyTypes.transit_tx_vout,
            value: paddedHexNumber(numAsHex(askForTransit.vout)),
          },
          {
            type: balancedChannelKeyTypes.funding_signature,
            value: fundingSignature,
          },
          {
            type: balancedChannelKeyTypes.transit_public_key,
            value: askForTransit.key,
          },
        ]);
      }],

      // Try using p2p communication to accept the request
      p2pAcceptRequest: [
        'acceptRecords',
        'prepareForProposal',
        ({acceptRecords}, cbk) =>
      {
        return makePeerRequest({
          lnd: args.lnd,
          records: [].concat(acceptRecords).concat({
            type: acceptRequestIdType,
            value: parsePaymentRequest({request: args.accept_request}).id,
          }),
          timeout: p2pTimeoutMs,
          to: args.partner_public_key,
          type: balancedChannelKeyTypes.accept_request,
        },
        err => {
          // Exit early when the request had an issue, fail back to TLV payment
          if (!!err) {
            return cbk(null, {is_accepted: false});
          }

          return cbk(null, {is_accepted: true});
        });
      }],

      // Pay the accept balanced channel request to send accept messages
      payAcceptRequest: [
        'acceptRecords',
        'p2pAcceptRequest',
        'prepareForProposal',
        ({acceptRecords, p2pAcceptRequest}, cbk) =>
      {
        // Exit early when the peer accepted over p2p comms
        if (!!p2pAcceptRequest.is_accepted) {
          return cbk();
        }

        return pay({
          lnd: args.lnd,
          max_fee_mtokens: defaultMaxFeeMtokens,
          messages: acceptRecords,
          request: args.accept_request,
        },
        cbk);
      }],

      // Wait for a pending channel
      waitForPendingChannel: [
        'askForTransit',
        'fundingTx',
        'payAcceptRequest',
        ({askForTransit, fundingTx}, cbk) =>
      {
        return waitForPendingOpen({
          interval,
          times,
          capacity: args.capacity,
          lnd: args.lnd,
          local_balance: giveTokens(args.capacity),
          partner_public_key: args.partner_public_key,
          transaction_id: fundingTx.transaction_id,
          transaction_vout: fundingTx.transaction_vout,
        },
        err => {
          if (!!err) {
            return cbk(err);
          }

          return cbk(null, {
            transaction_id: fundingTx.transaction_id,
            transaction_vout: fundingTx.transaction_vout,
            transactions: [askForTransit.transaction],
          });
        });
      }],

      // The peer should broadcast their funding
      peerBroadcast: ['waitForPendingChannel', ({}, cbk) => {
        const tokens = giveTokens(args.capacity) + fundingFee(args.fee_rate);

        args.logger.info({
          peer_transaction_id: args.remote_tx_id,
          paying: formatTokens({tokens}).display,
          out_index: args.remote_tx_vout,
        });

        return cbk();
      }],
    },
    returnResult({reject, resolve, of: 'waitForPendingChannel'}, cbk));
  });
};
