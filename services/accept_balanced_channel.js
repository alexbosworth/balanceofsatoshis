const {address} = require('bitcoinjs-lib');
const asyncAuto = require('async/auto');
const {connectPeer} = require('ln-sync');
const {formatTokens} = require('ln-sync');
const {getPeers} = require('ln-service');
const {getPublicKey} = require('ln-service');
const {maintainUtxoLocks} = require('ln-sync');
const {makePeerRequest} = require('paid-services');
const {networks} = require('bitcoinjs-lib');
const {parsePaymentRequest} = require('ln-service');
const {pay} = require('ln-service');
const {payments} = require('bitcoinjs-lib');
const {prepareForChannelProposal} = require('ln-service');
const {reserveTransitFunds} = require('ln-sync');
const {returnResult} = require('asyncjs-util');
const {signTransaction} = require('ln-service');
const {Transaction} = require('bitcoinjs-lib');
const {waitForPendingOpen} = require('ln-sync');

const {balancedChannelKeyTypes} = require('./service_key_types');

const acceptRequestIdType = '0';
const bufferAsHex = buffer => buffer.toString('hex');
const defaultMaxFeeMtokens = '9000';
const {fromBech32} = address;
const {fromHex} = Transaction;
const fundingAmount = (capacity, rate) => (capacity + (190 * rate)) / 2;
const fundingFee = rate => Math.ceil(190 / 2 * rate);
const giveTokens = capacity => Math.ceil(capacity / 2);
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const idAsHash = id => Buffer.from(id, 'hex').reverse();
const interval = 1000 * 15;
const {isArray} = Array;
const multiSigKeyFamily = 0;
const networkBitcoin = 'btc';
const networkRegtest = 'btcregtest';
const networkTestnet = 'btctestnet';
const numAsHex = num => num.toString(16);
const paddedHexNumber = n => n.length % 2 ? `0${n}` : n;
const {p2ms} = payments;
const {p2pkh} = payments;
const p2pTimeoutMs = 5000;
const {p2wsh} = payments;
const relockIntervalMs = 1000 * 20;
const times = 60 * 6;
const {toOutputScript} = address;
const transitKeyFamily = 805;

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

      // BitcoinJS Network
      network: ['validate', ({}, cbk) => {
        switch (args.network) {
        case networkBitcoin:
          return cbk(null, networks.bitcoin);

        case networkRegtest:
          return cbk(null, networks.regtest);

        case networkTestnet:
          return cbk(null, networks.testnet);

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
        const tx = new Transaction();

        const redeem = p2ms({
          m: keys.length,
          pubkeys: keys.sort().map(hexAsBuffer),
        });

        const remoteFunding = {
          id: args.remote_tx_id,
          vout: args.remote_tx_vout,
        };

        const multiSig = p2wsh({redeem});

        const script = multiSig.output;

        // The inputs to the funding tx are the transit transactions
        const inputs = [askForTransit, remoteFunding].map(({id, vout}) => ({
          hash: idAsHash(id),
          index: vout,
          sequence: Number(),
        }));

        // Sort the inputs for BIP 69 deterministic encoding
        inputs.sort((a, b) => {
          const aHash = bufferAsHex(a.hash);
          const bHash = bufferAsHex(b.hash);

          return aHash.localeCompare(bHash) || a.index - b.index;
        });

        // Add the inputs to the channel funding transaction
        inputs.forEach(n => tx.addInput(n.hash, n.index, n.sequence));

        // The output to the channel funding is capacity paid to the 2:2 addr
        tx.addOutput(script, args.capacity);

        args.logger.info({
          funding_tx_id: tx.getId(),
          waiting_for_full_channel_proposal: true,
        });

        return cbk(null, {
          pending_channel_id: bufferAsHex(multiSig.hash),
          transaction: tx.toHex(),
          transaction_id: tx.getId(),
          transaction_vout: tx.outs.findIndex(n => n.script.equals(script)),
        });
      }],

      // Sign the funding transaction spending the transit funds
      signFunding: [
        'askForTransit',
        'fundingTx',
        'network',
        ({askForTransit, fundingTx, network}, cbk) =>
      {
        const feeRate = args.fee_rate;
        const tokens = giveTokens(args.capacity) + fundingFee(args.fee_rate);
        const tx = fromHex(fundingTx.transaction);

        // Find the input index where the funding outpoint is being spent
        const fundingVin = tx.ins.findIndex(input => {
          if (input.index !== askForTransit.vout) {
            return false;
          }

          return input.hash.equals(idAsHash(askForTransit.id));
        });

        // Sign the channel funding transaction
        return signTransaction({
          lnd: args.lnd,
          inputs: [{
            key_family: transitKeyFamily,
            key_index: askForTransit.index,
            output_script: askForTransit.output,
            output_tokens: tokens,
            sighash: Transaction.SIGHASH_ALL,
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
