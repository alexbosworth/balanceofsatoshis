const {createHash} = require('crypto');
const {randomBytes} = require('crypto');

const {addPeer} = require('ln-service');
const {address} = require('bitcoinjs-lib');
const asyncAuto = require('async/auto');
const asyncDetectSeries = require('async/detectSeries');
const {cancelPendingChannel} = require('ln-service');
const {createInvoice} = require('ln-service');
const {createPsbt} = require('psbt');
const {getChainFeeRate} = require('ln-service');
const {getChannels} = require('ln-service');
const {getFundedTransaction} = require('goldengate');
const {getNode} = require('ln-service');
const {getPeers} = require('ln-service');
const {getPublicKey} = require('ln-service');
const {maintainUtxoLocks} = require('goldengate');
const {networks} = require('bitcoinjs-lib');
const {openChannels} = require('ln-service');
const {payViaRoutes} = require('ln-service');
const {payments} = require('bitcoinjs-lib');
const {proposeChannel} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {signTransaction} = require('ln-service');
const {subscribeToInvoice} = require('ln-service');
const {subscribeToProbeForRoute} = require('ln-service');
const {Transaction} = require('bitcoinjs-lib');

const {balancedChannelKeyTypes} = require('./service_key_types');
const {describeRoute} = require('./../display');
const {describeRoutingFailure} = require('./../display');
const getBalancedRefund = require('./get_balanced_refund');

const acceptBalancedType = '547418';
const acceptTokens = 1;
const balancedChannelOpenType = '547417';
const bufferAsHex = buffer => buffer.toString('hex');
const componentsSeparator = ' ';
const decBase = 10;
const defaultMaxFeeMtokens = '9000';
const derivePubKey = n => ECPair.fromPrivateKey(n).publicKey.toString('hex');
const encodeSig = (sig, hash) => Buffer.concat(Buffer.from(sig, 'hex'), hash);
const {fromBech32} = address;
const {fromHex} = Transaction;
const fundingAmount = (capacity, rate) => (capacity + (190 * rate)) / 2;
const fundingFee = rate => Math.ceil(190 / 2 * rate);
const giveTokens = capacity => Math.ceil(capacity / 2);
const hasInbound = channels => !!channels.find(n => !!n.remote_balance);
const hashHexLength = 64;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const idAsHash = id => Buffer.from(id, 'hex').reverse();
const isHexNumberSized = hex => hex.length < 14;
const isNumber = n => !isNaN(n);
const isOdd = n => n % 2;
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const keySendPreimageType = '5482373484';
const largeNumberByteCount = 8;
const makeDualControlP2wsh = pubkeys => p2wsh({redeem: p2ms({pubkeys, m: 2})});
const makeHtlcPreimage = () => randomBytes(32).toString('hex');
const maxSignatureLen = 150;
const multiSigKeyFamily = 0;
const networkBitcoin = 'btc';
const networkTestnet = 'btctestnet';
const notFoundIndex = -1;
const numAsHex = num => num.toString(16);
const paddedHexNumber = n => n.length % 2 ? `0${n}` : n;
const parseHexNumber = hex => parseInt(hex, 16);
const {p2ms} = payments;
const {p2pkh} = payments;
const {p2wsh} = payments;
const refundTxSize = 125;
const relockIntervalMs = 1000 * 20;
const {round} = Math;
const sendChannelRequestMtokens = '10000';
const sha256 = n => createHash('sha256').update(n).digest().toString('hex');
const sigHashAll = Buffer.from([Transaction.SIGHASH_ALL]);
const tokAsBigUnit = tokens => (tokens / 1e8).toFixed(8);
const {toOutputScript} = address;
const transitKeyFamily = 805;
const uint16ByteCount = 2;
const uint64ByteCount = 8;
const utf8AsHex = utf8 => Buffer.from(utf8).toString('hex');

/** Initiate a balanced channel

  {
    ask: <Ask Function>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    multisig_key_index: <Channel Funding MultiSig Index Number>
    network: <Network Name String>
    partner_public_key: <Peer Public Key Hex String>
    refund_address: <Pay Transit Key Funds to Refund Address String>
    transit_address: <Transit Pay to Witness Public Key Address String>
    transit_key_index: <Transit Key Index Number>
  }

  @returns via cbk or Promise
  {
    transaction_id: <Channel Funding Transaction Id Hex String>
    transaction_vout: <Channel Funding Tx Output Index Hex String>
    transactions: [<Funding Transaction Hex String>]
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.ask) {
          return cbk([400, 'ExpectedAskFunctionToInitBalancedChannel']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToInitBalancedChannel']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedWinstonLoggerToInitBalancedChannel']);
        }

        if (!args.network) {
          return cbk([400, 'ExpectedNetworkNameToInitBalancedChannel']);
        }

        if (args.multisig_key_index === undefined) {
          return cbk([400, 'ExpectedMultiSigKeyIdToInitBalancedChannel']);
        }

        if (!isPublicKey(args.partner_public_key)) {
          return cbk([400, 'ExpectedPartnerPublicKeyToInitBalancedChannel']);
        }

        if (!args.refund_address) {
          return cbk([400, 'ExpectedRefundAddressToInitBalancedChannel']);
        }

        if (!args.transit_address) {
          return cbk([400, 'ExpectedTransitAddressToInitiateBalancedChannel']);
        }

        if (args.transit_key_index === undefined) {
          return cbk([400, 'ExpectedTransitKeyToInitiateBalancedChannel']);
        }

        return cbk();
      },

      // Determine a baseline fee to suggest for the channel open
      getChainFee: ['validate', ({}, cbk) => {
        return getChainFeeRate({lnd: args.lnd}, cbk);
      }],

      // Get channels to make sure that we have at least one public channel
      getChannels: ['validate', ({}, cbk) => {
        return getChannels({
          is_active: true,
          is_public: true,
          lnd: args.lnd,
        },
        cbk);
      }],

      // Get the multisig key
      getMultiSigKey: ['validate', ({}, cbk) => {
        return getPublicKey({
          family: multiSigKeyFamily,
          index: args.multisig_key_index,
          lnd: args.lnd,
        },
        cbk);
      }],

      // Get connected peers
      getPeers: ['validate', ({}, cbk) => {
        return getPeers({lnd: args.lnd}, cbk);
      }],

      // Get the transit key
      getTransitKey: ['validate', ({}, cbk) => {
        return getPublicKey({
          family: transitKeyFamily,
          index: args.transit_key_index,
          lnd: args.lnd,
        },
        cbk);
      }],

      // Check to make sure there is a route to push the keysend to the node
      probeForRouteToNode: ['validate', ({}, cbk) => {
        const sub = subscribeToProbeForRoute({
          destination: args.partner_public_key,
          lnd: args.lnd,
          max_fee_mtokens: sendChannelRequestMtokens,
          mtokens: sendChannelRequestMtokens,
        });

        sub.on('error', err => {
          return cbk(err);
        });

        sub.on('probe_success', ({route}) => {
          sub.removeAllListeners();

          return cbk();
        });

        sub.on('probing', async ({route}) => {
          const {description} = await describeRoute({route, lnd: args.lnd});

          return args.logger.info({checking_route: description});
        });

        sub.on('end', () => {
          return cbk([503, 'FailedToFindRouteToNode']);
        });

        sub.on('routing_failure', async failure => {
          const {description} = await describeRoutingFailure({
            index: failure.index,
            lnd: args.lnd,
            reason: failure.reason,
            route: failure.route,
          });

          return args.logger.info({failure: description});
        });
      }],

      // BitcoinJS Network
      network: ['validate', ({}, cbk) => {
        switch (args.network) {
        case networkBitcoin:
          return cbk(null, networks.bitcoin);

        case networkTestnet:
          return cbk(null, networks.testnet);

        default:
          return cbk([400, 'UnsupportedNetworkForInitiatingBalancedChannel']);
        }
      }],

      // Make sure that there is a public channel that can receive the keysend
      confirmInboundChannel: ['getChannels', ({getChannels}, cbk) => {
        if (!hasInbound(getChannels.channels)) {
          return cbk([400, 'ExpectedInboundLiquidityOnExistingChannel']);
        }

        return cbk();
      }],

      // Get the node sockets
      getNode: ['getPeers', ({getPeers}, cbk) => {
        const connected = getPeers.peers.map(n => n.public_key);

        // Exit early when there is no need to connect to the node
        if (connected.includes(args.partner_public_key)) {
          return cbk();
        }

        return getNode({
          is_omitting_channels: true,
          lnd: args.lnd,
          public_key: args.partner_public_key,
        },
        cbk);
      }],

      // Connect to the node if not connected
      connect: ['getNode', ({getNode}, cbk) => {
        // Exit early when there is no node to connect to
        if (!getNode) {
          return cbk();
        }

        return asyncDetectSeries(getNode.sockets, ({socket}, cbk) => {
          return addPeer({
            socket,
            lnd: args.lnd,
            public_key: args.partner_public_key
          },
          err => cbk(null, !err));
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          if (!res) {
            return cbk([503, 'FailedToConnectToPeer']);
          }

          return cbk(null, res);
        });
      }],

      // Ask for what capacity to propose
      askForCapacity: ['connect', 'probeForRouteToNode', ({}, cbk) => {
        const funding = {
          message: 'Total capacity of the new channel?',
          name: 'capacity',
          type: 'number'
        };

        return args.ask(funding, ({capacity}) => {
          if (!isNumber(capacity)) {
            return cbk([400, 'ExpectedChannelCapacityAmountToRequestOpen']);
          }

          if (isOdd(capacity)) {
            return cbk([400, 'ExpectedEvenCapacityToSplitBalance']);
          }

          return cbk(null, capacity);
        });
      }],

      // Create regular open request to confirm the channel can be created
      testOpenChannel: [
        'askForCapacity',
        'connect',
        ({askForCapacity}, cbk) =>
      {
        return openChannels({
          channels: [{
            capacity: askForCapacity,
            give_tokens: giveTokens(askForCapacity),
            partner_public_key: args.partner_public_key,
          }],
          lnd: args.lnd,
        },
        cbk);
      }],

      // Cancel the test open channel request
      cancelTestOpen: ['testOpenChannel', ({testOpenChannel}, cbk) => {
        const [{id}] = testOpenChannel.pending;

        return cancelPendingChannel({id, lnd: args.lnd}, cbk);
      }],

      // Ask for what fee rate to use
      askForFeeRate: [
        'askForCapacity',
        'getChainFee',
        ({askForCapacity, getChainFee}, cbk) =>
      {
        const feeRate = {
          default: round(getChainFee.tokens_per_vbyte),
          message: 'Fee rate per vbyte for the joint funding transaction?',
          name: 'rate',
          type: 'number',
        };

        return args.ask(feeRate, ({rate}) => {
          if (!isNumber(rate)) {
            return cbk([400, 'ExpectedFeeRatePerVirtualByteToProposeChannel']);
          }

          return cbk(null, rate);
        });
      }],

      // Ask for a transaction that pays to the transitive address
      askForFunding: [
        'askForCapacity',
        'askForFeeRate',
        'network',
        ({askForCapacity, askForFeeRate, network}, cbk) =>
      {
        const tokens = fundingAmount(askForCapacity, askForFeeRate);
        const transitOutput = toOutputScript(args.transit_address, network);

        return getFundedTransaction({
          ask: args.ask,
          chain_fee_tokens_per_vbyte: askForFeeRate,
          lnd: args.lnd,
          logger: args.logger,
          outputs: [{tokens, address: args.transit_address}],
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          const fund = res.transaction;

          if (!fund) {
            return cbk([400, 'ExpectedTransactionToInitiateBalancedOpen']);
          }

          const txVout = fromHex(fund).outs.findIndex(({script}) => {
            return script.equals(transitOutput);
          });

          if (txVout === notFoundIndex) {
            return cbk([400, 'ExpectedInitTxOutputPayingToTransitAddress']);
          }

          // The transaction must have an output sending to the address
          if (fromHex(fund).outs[txVout].value !== tokens) {
            return cbk([400, 'UnexpectedFundingAmountPayingToTransitAddress']);
          }

          if (!!res.inputs) {
            // Maintain a lock on the UTXOs until the tx confirms
            maintainUtxoLocks({
              id: res.id,
              inputs: res.inputs,
              interval: relockIntervalMs,
              lnd: args.lnd,
            },
            () => {});
          }

          return cbk(null, {
            tokens,
            inputs: res.inputs,
            transaction: fund,
            transaction_id: res.id,
            transaction_vout: txVout,
          });
        });
      }],

      // Derive a refund transaction that pays back the funding to refund addr
      getRefundTransaction: [
        'askForCapacity',
        'askForFunding',
        'getTransitKey',
        ({askForCapacity, askForFunding, getTransitKey}, cbk) =>
      {
        return getBalancedRefund({
          funded_tokens: askForFunding.tokens,
          lnd: args.lnd,
          network: args.network,
          refund_address: args.refund_address,
          refund_tokens: giveTokens(askForCapacity),
          transit_address: args.transit_address,
          transit_key_index: args.transit_key_index,
          transit_public_key: getTransitKey.public_key,
          transaction_id: askForFunding.transaction_id,
          transaction_vout: askForFunding.transaction_vout,
        },
        cbk);
      }],

      // Messages to push
      messagesToPush: [
        'askForCapacity',
        'askForFeeRate',
        'askForFunding',
        'getMultiSigKey',
        ({
          askForCapacity,
          askForFeeRate,
          askForFunding,
          getMultiSigKey,
        },
        cbk) =>
      {
        const secret = makeHtlcPreimage();

        const messages = [
          {
            type: keySendPreimageType,
            value: secret,
          },
          {
            type: balancedChannelKeyTypes.channel_capacity,
            value: paddedHexNumber(numAsHex(askForCapacity)),
          },
          {
            type: balancedChannelKeyTypes.funding_tx_fee_rate,
            value: paddedHexNumber(numAsHex(askForFeeRate)),
          },
          {
            type: balancedChannelKeyTypes.multisig_public_key,
            value: getMultiSigKey.public_key,
          },
          {
            type: balancedChannelKeyTypes.transit_tx_id,
            value: askForFunding.transaction_id,
          },
          {
            type: balancedChannelKeyTypes.transit_tx_vout,
            value: paddedHexNumber(numAsHex(askForFunding.transaction_vout)),
          },
        ];

        messages.sort((a, b) => Number(a.type) - Number(b.type));

        const digest = Buffer.concat(messages.map(message => {
          const type = Buffer.alloc(largeNumberByteCount);

          type.writeBigUInt64BE(BigInt(message.type));

          return Buffer.concat([type, hexAsBuffer(message.value)]);
        }));

        return cbk(null, {
          messages,
          digest: sha256(digest),
          id: sha256(hexAsBuffer(secret)),
        });
      }],

      // Create an accept payment request
      createAcceptRequest: ['messagesToPush', ({messagesToPush}, cbk) => {
        return createInvoice({
          description_hash: messagesToPush.digest,
          lnd: args.lnd,
          tokens: acceptTokens,
        },
        cbk);
      }],

      // Send the key send to the accepting peer
      pushRequest: [
        'createAcceptRequest',
        'getRefundTransaction',
        'messagesToPush',
        ({
          createAcceptRequest,
          getRefundTransaction,
          messagesToPush,
        },
        cbk) =>
      {
        args.logger.info({refund_transaction: getRefundTransaction.refund});

        const messages = []
          .concat(messagesToPush.messages)
          .concat({
            type: balancedChannelKeyTypes.accept_request,
            value: utf8AsHex(createAcceptRequest.request),
          });

        const sub = subscribeToProbeForRoute({
          messages,
          destination: args.partner_public_key,
          lnd: args.lnd,
          max_fee_mtokens: sendChannelRequestMtokens,
          mtokens: sendChannelRequestMtokens,
        });

        sub.on('error', err => {
          return cbk([503, 'MessageDeliveryFailedToNode', {err}]);
        });

        sub.on('probe_success', ({route}) => {
          sub.removeAllListeners();

          args.logger.info({requesting_balanced_open_channel: true});

          return payViaRoutes({
            id: messagesToPush.id,
            lnd: args.lnd,
            routes: [route],
          },
          cbk);
        });

        sub.on('probing', async ({route}) => {
          const {description} = await describeRoute({route, lnd: args.lnd});

          return args.logger.info({finding_route: description});
        });

        sub.on('end', () => {
          return cbk([503, 'OpenBalancedChannelMessageDeliveryFailedToNode']);
        });

        sub.on('routing_failure', async failure => {
          const {description} = await describeRoutingFailure({
            index: failure.index,
            lnd: args.lnd,
            reason: failure.reason,
            route: failure.route,
          });

          return args.logger.info({failure: description});
        });
      }],

      // Wait for response to the payment req
      waitForAccept: [
        'askForFunding',
        'createAcceptRequest',
        'pushRequest',
        ({askForFunding, createAcceptRequest}, cbk) =>
      {
        args.logger.info({waiting_for_peer_balanced_channel_acceptance: true});

        const multiSigType = balancedChannelKeyTypes.multisig_public_key;

        const sub = subscribeToInvoice({
          id: createAcceptRequest.id,
          lnd: args.lnd,
        });

        sub.on('error', err => {
          sub.removeAllListeners();

          return cbk([503, 'UnexpectedErrorWaitingForChannelAccept', {err}]);
        });

        sub.on('invoice_updated', invoice => {
          if (!invoice.is_confirmed) {
            return;
          }

          args.logger.info({received_peer_balanced_channel_acceptance: true});

          sub.removeAllListeners();

          const acceptDetailsPayment = invoice.payments.find(payment => {
            return !!payment.messages.find(n => n.type === multiSigType);
          });

          if (!acceptDetailsPayment) {
            return cbk([503, 'ExpectedPaymentWithPeerChannelDetails']);
          }

          const {messages} = acceptDetailsPayment;

          const remoteMultiSigPublicKey = messages.find(({type}) => {
            return type === multiSigType;
          });

          if (!remoteMultiSigPublicKey) {
            return cbk([503, 'AcceptResponseMissingTransitPublicKey']);
          }

          if (!isPublicKey(remoteMultiSigPublicKey.value)) {
            return cbk([503, 'GotInvalidFundingTransitPublicKey']);
          }

          const transitTxId = messages.find(({type}) => {
            return type === balancedChannelKeyTypes.transit_tx_id;
          });

          if (!transitTxId || transitTxId.value.length !== hashHexLength) {
            return cbk([503, 'AcceptResponseMissingTransitTransactionId']);
          }

          const transitTxVout = messages.find(({type}) => {
            return type === balancedChannelKeyTypes.transit_tx_vout;
          });

          if (!transitTxVout || !isHexNumberSized(transitTxVout.value)) {
            return cbk([503, 'AcceptResponseMissingTransitTransactionVout']);
          }

          const fundSignature = messages.find(({type}) => {
            return type === balancedChannelKeyTypes.funding_signature;
          });

          if (!fundSignature || fundSignature.value.length > maxSignatureLen) {
            return cbk([503, 'AcceptResponseMissingFundingSignature']);
          }

          const fundTransitKey = messages.find(({type}) => {
            return type === balancedChannelKeyTypes.transit_public_key;
          });

          if (!fundTransitKey) {
            return cbk([503, 'AcceptResponseMissingFundTransitKey']);
          }

          if (!isPublicKey(fundTransitKey.value)) {
            return cbk([503, 'GotInvalidFundingTransitPublicKey']);
          }

          const fundingSignature = hexAsBuffer(fundSignature.value);

          const signature = Buffer.concat([fundingSignature, sigHashAll]);

          return cbk(null, {
            funding_signature: bufferAsHex(signature),
            multisig_public_key: remoteMultiSigPublicKey.value,
            transaction_id: transitTxId.value,
            transaction_vout: parseHexNumber(transitTxVout.value),
            transit_public_key: fundTransitKey.value,
          });
        });
      }],

      // Derive the multi-sig address
      deriveFundingAddress: [
        'getMultiSigKey',
        'waitForAccept',
        ({getMultiSigKey, waitForAccept}, cbk) =>
      {
        const publicKeys = [
          getMultiSigKey.public_key,
          waitForAccept.multisig_public_key,
        ];

        const funding = p2wsh({
          redeem: p2ms({
            m: publicKeys.length,
            pubkeys: publicKeys.sort().map(hexAsBuffer),
          }),
        });

        return cbk(null, {
          hash: bufferAsHex(funding.hash),
          script: bufferAsHex(funding.output),
        });
      }],

      // Create a transaction that pays into the multi-sig output script
      halfSign: [
        'askForCapacity',
        'askForFunding',
        'deriveFundingAddress',
        'waitForAccept',
        ({
          askForCapacity,
          askForFunding,
          deriveFundingAddress,
          waitForAccept,
        },
        cbk) =>
      {
        const tx = new Transaction();
        const utxos = [askForFunding, waitForAccept];

        const inputs = utxos.map(utxo => ({
          hash: idAsHash(utxo.transaction_id),
          index: utxo.transaction_vout,
          sequence: Number(),
        }));

        // Sort the inputs for BIP 69 deterministic encoding
        inputs.sort((a, b) => {
          const aHash = bufferAsHex(a.hash);
          const bHash = bufferAsHex(b.hash);

          return aHash.localeCompare(bHash) || a.index - b.index;
        });

        inputs.forEach(n => tx.addInput(n.hash, n.index, n.sequence));

        const partnersVin = tx.ins.findIndex(input => {
          if (input.index !== waitForAccept.transaction_vout) {
            return false;
          }

          return input.hash.equals(idAsHash(waitForAccept.transaction_id));
        });

        const partnerWitnessStack = [
          waitForAccept.funding_signature,
          waitForAccept.transit_public_key,
        ];

        tx.setWitness(partnersVin, partnerWitnessStack.map(hexAsBuffer));

        tx.addOutput(hexAsBuffer(deriveFundingAddress.script), askForCapacity);

        return cbk(null, tx);
      }],

      // Get a signature to funds the channel funding transaction
      signChannelFunding: [
        'askForCapacity',
        'askForFeeRate',
        'askForFunding',
        'halfSign',
        'network',
        'waitForAccept',
        ({
          askForCapacity,
          askForFeeRate,
          askForFunding,
          halfSign,
          network,
        },
        cbk) =>
      {
        const feeRate = askForFeeRate;
        const hash = fromBech32(args.transit_address).data;
        const tx = halfSign;

        const fundingVin = tx.ins.findIndex(input => {
          if (input.index !== askForFunding.transaction_vout) {
            return false;
          }

          return input.hash.equals(idAsHash(askForFunding.transaction_id));
        });

        const outputScript = toOutputScript(args.transit_address, network);

        // Sign the channel funding transaction
        return signTransaction({
          lnd: args.lnd,
          inputs: [{
            key_family: transitKeyFamily,
            key_index: args.transit_key_index,
            output_script: bufferAsHex(outputScript),
            output_tokens: giveTokens(askForCapacity) + fundingFee(feeRate),
            sighash: Transaction.SIGHASH_ALL,
            vin: fundingVin,
            witness_script: bufferAsHex(p2pkh({hash}).output),
          }],
          transaction: tx.toHex(),
        },
        cbk);
      }],

      // Update funding transaction with the signature
      fullySignedFunding: [
        'askForCapacity',
        'askForFunding',
        'deriveFundingAddress',
        'getMultiSigKey',
        'getTransitKey',
        'halfSign',
        'signChannelFunding',
        ({
          askForCapacity,
          askForFunding,
          deriveFundingAddress,
          getMultiSigKey,
          getTransitKey,
          halfSign,
          signChannelFunding,
        },
        cbk) =>
      {
        const publicKey = hexAsBuffer(getTransitKey.public_key);
        const [signature] = signChannelFunding.signatures;
        const tx = halfSign;

        // Add the signature hash flag to the end of the signature
        const fundingSignature = Buffer.concat([
          hexAsBuffer(signature),
          sigHashAll,
        ]);

        // Find the transits input associated with the peer
        const fundingVin = tx.ins.findIndex(input => {
          if (input.index !== askForFunding.transaction_vout) {
            return false;
          }

          return input.hash.equals(idAsHash(askForFunding.transaction_id));
        });

        tx.setWitness(fundingVin, [fundingSignature, publicKey]);

        const txVout = tx.outs.findIndex(({script, value}) => {
          if (value !== askForCapacity) {
            return false;
          }

          return script.equals(hexAsBuffer(deriveFundingAddress.script));
        });

        return cbk(null, {
          transaction: tx.toHex(),
          transaction_id: tx.getId(),
          transaction_vout: txVout,
        });
      }],

      // Propose the channel
      propose: [
        'askForCapacity',
        'deriveFundingAddress',
        'fullySignedFunding',
        'waitForAccept',
        ({
          askForCapacity,
          deriveFundingAddress,
          fullySignedFunding,
          waitForAccept,
        },
        cbk) =>
      {
        const tx = fromHex(fullySignedFunding.transaction);

        const txVout = tx.outs.findIndex(({script, value}) => {
          if (value !== askForCapacity) {
            return false;
          }

          return script.equals(hexAsBuffer(deriveFundingAddress.script));
        });

        return proposeChannel({
          capacity: askForCapacity,
          give_tokens: giveTokens(askForCapacity),
          id: deriveFundingAddress.hash,
          key_index: args.multisig_key_index,
          lnd: args.lnd,
          partner_public_key: args.partner_public_key,
          remote_key: waitForAccept.multisig_public_key,
          transaction_id: tx.getId(),
          transaction_vout: txVout,
        },
        cbk);
      }],

      // The initiated proposal is a transit tx and a funding tx
      initiated: [
        'askForFunding',
        'fullySignedFunding',
        ({askForFunding, fullySignedFunding}, cbk) =>
      {
        const transactions = [askForFunding, fullySignedFunding];

        return cbk(null, {
          transaction_id: fullySignedFunding.transaction_id,
          transaction_vout: fullySignedFunding.transaction_vout,
          transactions: transactions.map(n => n.transaction),
        });
      }],
    },
    returnResult({reject, resolve, of: 'initiated'}, cbk));
  });
};
