const {createHash} = require('crypto');
const {randomBytes} = require('crypto');

const {acceptsChannelOpen} = require('ln-sync');
const {addPeer} = require('ln-service');
const asyncAuto = require('async/auto');
const asyncDetectSeries = require('async/detectSeries');
const {cancelHodlInvoice} = require('ln-service');
const {connectPeer} = require('ln-sync');
const {createInvoice} = require('ln-service');
const {getChainFeeRate} = require('ln-service');
const {getChannels} = require('ln-service');
const {getPeers} = require('ln-service');
const {getPublicKey} = require('ln-service');
const {maintainUtxoLocks} = require('ln-sync');
const {payViaRoutes} = require('ln-service');
const {payments} = require('bitcoinjs-lib');
const {proposeChannel} = require('ln-service');
const {reserveTransitFunds} = require('ln-sync');
const {returnResult} = require('asyncjs-util');
const {sendMessageToPeer} = require('ln-service');
const {servicePeerRequests} = require('paid-services');
const {signTransaction} = require('ln-service');
const {subscribeToInvoice} = require('ln-service');
const {subscribeToProbeForRoute} = require('ln-service');
const {Transaction} = require('bitcoinjs-lib');

const {balancedChannelKeyTypes} = require('./service_key_types');
const balancedOpenAcceptDetails = require('./balanced_open_accept_details');
const {describeRoute} = require('./../display');
const {describeRoutingFailure} = require('./../display');

const acceptTokens = 1;
const bufferAsHex = buffer => buffer.toString('hex');
const defaultMaxFeeMtokens = '9000';
const {fromHex} = Transaction;
const fundingAmount = (capacity, rate) => (capacity + (190 * rate)) / 2;
const fundingFee = rate => Math.ceil(190 / 2 * rate);
const giveTokens = capacity => Math.ceil(capacity / 2);
const hasInbound = channels => !!channels.find(n => !!n.remote_balance);
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const idAsHash = id => Buffer.from(id, 'hex').reverse();
const {isInteger} = Number;
const isNumber = n => !isNaN(n);
const isOdd = n => n % 2;
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const keySendPreimageType = '5482373484';
const largeNumberByteCount = 8;
const makeHtlcPreimage = () => randomBytes(32).toString('hex');
const maxSignatureLen = 150;
const multiSigKeyFamily = 0;
const multiSigType = balancedChannelKeyTypes.multisig_public_key;
const numAsHex = num => num.toString(16);
const paddedHexNumber = n => n.length % 2 ? `0${n}` : n;
const peerFailure = (fail, cbk, err) => { fail(err); return cbk(err); };
const {p2ms} = payments;
const {p2wsh} = payments;
const relockIntervalMs = 1000 * 20;
const {round} = Math;
const sendChannelRequestMtokens = '10000';
const sha256 = n => createHash('sha256').update(n).digest().toString('hex');
const sigHashAll = Buffer.from([Transaction.SIGHASH_ALL]);
const testMessage = '00';
const tokAsBigUnit = tokens => (tokens / 1e8).toFixed(8);
const transitKeyFamily = 805;
const utf8AsHex = utf8 => Buffer.from(utf8).toString('hex');

/** Initiate a balanced channel

  {
    [address]: <Use Cooperative Close Address String>
    ask: <Ask Function>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    multisig_key_index: <Channel Funding MultiSig Index Number>
    partner_public_key: <Peer Public Key Hex String>
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

        if (args.multisig_key_index === undefined) {
          return cbk([400, 'ExpectedMultiSigKeyIdToInitBalancedChannel']);
        }

        if (!isPublicKey(args.partner_public_key)) {
          return cbk([400, 'ExpectedPartnerPublicKeyToInitBalancedChannel']);
        }

        return cbk();
      },

      // Connect to the peer
      connect: ['validate', ({}, cbk) => {
        return connectPeer({id: args.partner_public_key, lnd: args.lnd}, cbk);
      }],

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

      // Make sure that there is a public channel that can receive the keysend
      confirmInboundChannel: ['getChannels', ({getChannels}, cbk) => {
        if (!hasInbound(getChannels.channels)) {
          return cbk([400, 'ExpectedInboundLiquidityOnExistingChannel']);
        }

        return cbk();
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
        return acceptsChannelOpen({
          capacity: askForCapacity,
          give_tokens: giveTokens(askForCapacity),
          lnd: args.lnd,
          partner_public_key: args.partner_public_key,
        },
        cbk);
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
          validate: n => !!isNumber(n) && !!Number(n) && isInteger(Number(n)),
        };

        return args.ask(feeRate, ({rate}) => {
          if (!isNumber(Number(rate))) {
            return cbk([400, 'ExpectedFeeRatePerVirtualByteToProposeChannel']);
          }

          return cbk(null, rate);
        });
      }],

      // Ask for a transaction that pays to the transitive address
      askForFunding: [
        'askForCapacity',
        'askForFeeRate',
        ({askForCapacity, askForFeeRate}, cbk) =>
      {
        return reserveTransitFunds({
          ask: args.ask,
          lnd: args.lnd,
          logger: args.logger,
          rate: askForFeeRate,
          tokens: fundingAmount(askForCapacity, askForFeeRate),
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
        if (!!askForFunding.inputs) {
          // Maintain a lock on the UTXOs until the tx confirms
          maintainUtxoLocks({
            id: askForFunding.id,
            inputs: askForFunding.inputs,
            interval: relockIntervalMs,
            lnd: args.lnd,
          },
          () => {});
        }

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
            value: askForFunding.id,
          },
          {
            type: balancedChannelKeyTypes.transit_tx_vout,
            value: paddedHexNumber(numAsHex(askForFunding.vout)),
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

      // Make peer custom message request
      p2pService: ['askForFunding', 'createAcceptRequest', ({}, cbk) => {
        // Test that custom message sending is supported
        return sendMessageToPeer({
          message: testMessage,
          lnd: args.lnd,
          public_key: args.partner_public_key,
        },
        err => {
          // Provide a dummy p2p service when messages cannot be sent to peer
          if (!!err) {
            return cbk(null, {request: () => {}, stop: () => {}});
          }

          return cbk(null, servicePeerRequests({lnd: args.lnd}));
        });
      }],

      // Send the key send to the accepting peer
      pushRequest: [
        'askForFunding',
        'createAcceptRequest',
        'messagesToPush',
        ({askForFunding, createAcceptRequest, messagesToPush}, cbk) =>
      {
        args.logger.info({refund_transaction: askForFunding.refund});

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
        'p2pService',
        'pushRequest',
        ({askForFunding, createAcceptRequest, p2pService}, cbk) =>
      {
        args.logger.info({waiting_for_peer_balanced_channel_acceptance: true});

        const sub = subscribeToInvoice({
          id: createAcceptRequest.id,
          lnd: args.lnd,
        });

        // Wait for a p2p accept message
        p2pService.request({
          type: balancedChannelKeyTypes.accept_request,
        },
        (req, res) => {
          // Exit early when the request is not from the peer
          if (req.from !== args.partner_public_key) {
            return;
          }

          const idRecord = req.records.find(n => !BigInt(n.type));

          // Exit early when the request is not for this open
          if (!idRecord || idRecord.value !== createAcceptRequest.id) {
            return;
          }

          // Remove the invoice listener
          sub.removeAllListeners();

          // Remove the p2p requests listener
          p2pService.stop({});

          // Stop listening on the invoice
          cancelHodlInvoice({id: idRecord.value, lnd: args.lnd}, err => {
            return !!err ? args.logger.error({err}) : null;
          });

          args.logger.info({received_balanced_channel_acceptance: true});

          const {records} = req;

          try {
            const acceptance = balancedOpenAcceptDetails({records});

            // Respond to the peer accept request
            res.success({});

            return cbk(null, acceptance);
          } catch (err) {
            // Tell the peer there was a failure
            return peerFailure(res.failure, cbk, [503, err.message]);
          }
        });

        sub.on('error', err => {
          // Remove the invoice listener
          sub.removeAllListeners();

          // Remove the p2p requests listener
          p2pService.stop({});

          return cbk([503, 'UnexpectedErrorWaitingForChannelAccept', {err}]);
        });

        // Wait for acceptance by invoice
        sub.on('invoice_updated', invoice => {
          if (!invoice.is_confirmed) {
            return;
          }

          args.logger.info({received_peer_balanced_channel_acceptance: true});

          // No more listening is required
          sub.removeAllListeners();

          // Turn off the p2p listener
          p2pService.stop({});

          // Find accept records
          const acceptDetailsPayment = invoice.payments.find(payment => {
            return !!payment.messages.find(n => n.type === multiSigType);
          });

          if (!acceptDetailsPayment) {
            return cbk([503, 'ExpectedPaymentWithPeerChannelDetails']);
          }

          const {messages} = acceptDetailsPayment;

          try {
            return cbk(null, balancedOpenAcceptDetails({records: messages}));
          } catch (err) {
            return cbk([503, err.message]);
          }
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

        const utxos = [
          {
            transaction_id: askForFunding.id,
            transaction_vout: askForFunding.vout,
          },
          waitForAccept,
        ];

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
        'waitForAccept',
        ({
          askForCapacity,
          askForFeeRate,
          askForFunding,
          halfSign,
        },
        cbk) =>
      {
        const feeRate = askForFeeRate;

        // Find the input index where the funding outpoint is being spent
        const fundingVin = halfSign.ins.findIndex(input => {
          if (input.index !== askForFunding.vout) {
            return false;
          }

          return input.hash.equals(idAsHash(askForFunding.id));
        });

        // Sign the channel funding transaction
        return signTransaction({
          lnd: args.lnd,
          inputs: [{
            key_family: transitKeyFamily,
            key_index: askForFunding.index,
            output_script: askForFunding.output,
            output_tokens: giveTokens(askForCapacity) + fundingFee(feeRate),
            sighash: Transaction.SIGHASH_ALL,
            vin: fundingVin,
            witness_script: askForFunding.script,
          }],
          transaction: halfSign.toHex(),
        },
        cbk);
      }],

      // Update funding transaction with the signature
      fullySignedFunding: [
        'askForCapacity',
        'askForFunding',
        'deriveFundingAddress',
        'getMultiSigKey',
        'halfSign',
        'signChannelFunding',
        ({
          askForCapacity,
          askForFunding,
          deriveFundingAddress,
          getMultiSigKey,
          halfSign,
          signChannelFunding,
        },
        cbk) =>
      {
        const publicKey = hexAsBuffer(askForFunding.key);
        const [signature] = signChannelFunding.signatures;
        const tx = halfSign;

        // Add the signature hash flag to the end of the signature
        const fundingSignature = Buffer.concat([
          hexAsBuffer(signature),
          sigHashAll,
        ]);

        // Find the transits input associated with the peer
        const fundingVin = tx.ins.findIndex(input => {
          if (input.index !== askForFunding.vout) {
            return false;
          }

          return input.hash.equals(idAsHash(askForFunding.id));
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
          cooperative_close_address: args.address,
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
