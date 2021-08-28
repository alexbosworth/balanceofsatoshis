const {address} = require('bitcoinjs-lib');
const asyncAuto = require('async/auto');
const asyncRetry = require('async/retry');
const {formatTokens} = require('ln-sync');
const {getFundedTransaction} = require('goldengate');
const {getPeers} = require('ln-service');
const {getPendingChannels} = require('ln-service');
const {getPublicKey} = require('ln-service');
const {maintainUtxoLocks} = require('goldengate');
const {networks} = require('bitcoinjs-lib');
const {pay} = require('ln-service');
const {payments} = require('bitcoinjs-lib');
const {prepareForChannelProposal} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {signTransaction} = require('ln-service');
const {Transaction} = require('bitcoinjs-lib');

const {balancedChannelKeyTypes} = require('./service_key_types');
const getBalancedRefund = require('./get_balanced_refund');

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
const multiSigKeyFamily = 0;
const networkBitcoin = 'btc';
const networkTestnet = 'btctestnet';
const notFoundIndex = -1;
const numAsHex = num => num.toString(16);
const paddedHexNumber = n => n.length % 2 ? `0${n}` : n;
const {p2ms} = payments;
const {p2pkh} = payments;
const {p2wsh} = payments;
const relockIntervalMs = 1000 * 20;
const times = 60 * 6;
const {toOutputScript} = address;
const tokAsBigUnit = tokens => (tokens / 1e8).toFixed(8);
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
    refund_address: <Refund Address String>
    remote_multisig_key: <Remote MultiSig Public Key Hex String>
    remote_tx_id: <Remote Transit Transaction Id Hex String>
    remote_tx_vout: <Remote Transit Transaction Output Index Number>
    transit_address: <Transit Address String>
    transit_key_index: <Transit Key Index Number>
    transit_public_key: <Transit Public Key Address String>
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

        if (!args.refund_address) {
          return cbk([400, 'ExpectedRefundAddressToAcceptBalancedChannel']);
        }

        if (!args.remote_multisig_key) {
          return cbk([400, 'ExpectedRemoteMultiSigPublicKeyToAcceptChannel']);
        }

        if (!args.partner_public_key) {
          return cbk([400, 'ExpectedPartnerPublicKeyToAcceptBalancedChannel']);
        }

        if (!args.transit_address) {
          return cbk([400, 'ExpectedTransitAddressToAcceptBalancedChannel']);
        }

        if (args.transit_key_index === undefined) {
          return cbk([400, 'ExpectedTransitKeyIndexToAcceptBalancedChannel']);s
        }

        if (!args.transit_public_key) {
          return cbk([400, 'ExpectedTransitPublicKeyToAcceptBalancedChannel']);
        }

        return cbk();
      },

      // Derive the multisig 2:2 key
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

      // BitcoinJS Network
      network: ['validate', ({}, cbk) => {
        switch (args.network) {
        case networkBitcoin:
          return cbk(null, networks.bitcoin);

        case networkTestnet:
          return cbk(null, networks.testnet);

        default:
          return cbk([400, 'UnsupportedNetworkForAcceptingBalancedChannel']);
        }
      }],

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
      askForTransit: ['confirmPeer', 'network', ({network}, cbk) => {
        const tokens = fundingAmount(args.capacity, args.fee_rate);
        const transitOutput = toOutputScript(args.transit_address, network);

        return getFundedTransaction({
          ask: args.ask,
          chain_fee_tokens_per_vbyte: args.fee_rate,
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
            return cbk([400, 'ExpectedFundedTransactionToAcceptBalancedOpen']);
          }

          const txVout = fromHex(fund).outs.findIndex(({script}) => {
            return script.equals(transitOutput);
          });

          if (txVout === notFoundIndex) {
            return cbk([400, 'ExpectedAcceptTxOutputPayingToTransitAddress']);
          }

          // The transaction must have an output sending to the address
          if (fromHex(fund).outs[txVout].value !== tokens) {
            return cbk([
              400,
              'UnexpectedFundingAmountPayingToTransitAddress',
              {expected: tokens},
            ]);
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
      getRefundTransaction: ['askForTransit', ({askForTransit}, cbk) => {
        return getBalancedRefund({
          funded_tokens: askForTransit.tokens,
          lnd: args.lnd,
          network: args.network,
          refund_address: args.refund_address,
          refund_tokens: giveTokens(args.capacity),
          transit_address: args.transit_address,
          transit_key_index: args.transit_key_index,
          transit_public_key: args.transit_public_key,
          transaction_id: askForTransit.transaction_id,
          transaction_vout: askForTransit.transaction_vout,
        },
        cbk);
      }],

      // Create the funding transaction to sign with the transit key
      fundingTx: [
        'askForTransit',
        'getMultiSigKey',
        'getRefundTransaction',
        ({askForTransit, getMultiSigKey, getRefundTransaction}, cbk) =>
      {
        args.logger.info({refund_transaction: getRefundTransaction.refund});

        const keys = [getMultiSigKey.public_key, args.remote_multisig_key];
        const tx = new Transaction();

        const redeem = p2ms({
          m: keys.length,
          pubkeys: keys.sort().map(hexAsBuffer),
        });

        const remoteFunding = {
          transaction_id: args.remote_tx_id,
          transaction_vout: args.remote_tx_vout,
        };

        const multiSig = p2wsh({redeem});

        const script = multiSig.output;

        // The inputs to the funding tx are the transit transactions
        const inputs = [askForTransit, remoteFunding].map(utxo => ({
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

        // Add the inputs to the channel funding transaction
        inputs.forEach(n => tx.addInput(n.hash, n.index, n.sequence));

        // The output to the channel funding is capacity paid to the 2:2 addr
        tx.addOutput(script, args.capacity);

        args.logger.info({funding_tx_id: tx.getId()});

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
        const hash = fromBech32(args.transit_address, network).data;
        const tokens = giveTokens(args.capacity) + fundingFee(args.fee_rate);
        const tx = fromHex(fundingTx.transaction);

        const fundingVin = tx.ins.findIndex(input => {
          if (input.index !== askForTransit.transaction_vout) {
            return false;
          }

          return input.hash.equals(idAsHash(askForTransit.transaction_id));
        });

        // The output script for a p2wpkh is the p2pkh hash script
        const {output} = p2pkh({hash});

        const outputScript = toOutputScript(args.transit_address, network);

        // Sign the channel funding transaction
        return signTransaction({
          lnd: args.lnd,
          inputs: [{
            key_family: transitKeyFamily,
            key_index: args.transit_key_index,
            output_script: bufferAsHex(outputScript),
            output_tokens: tokens,
            sighash: Transaction.SIGHASH_ALL,
            vin: fundingVin,
            witness_script: bufferAsHex(output),
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

      // Pay the accept balanced channel request
      payAcceptRequest: [
        'askForTransit',
        'getMultiSigKey',
        'prepareForProposal',
        'signFunding',
        ({askForTransit, getMultiSigKey, signFunding}, cbk) =>
      {
        const [fundingSignature] = signFunding.signatures;

        return pay({
          lnd: args.lnd,
          max_fee_mtokens: defaultMaxFeeMtokens,
          messages: [
            {
              type: balancedChannelKeyTypes.multisig_public_key,
              value: getMultiSigKey.public_key,
            },
            {
              type: balancedChannelKeyTypes.transit_tx_id,
              value: askForTransit.transaction_id,
            },
            {
              type: balancedChannelKeyTypes.transit_tx_vout,
              value: paddedHexNumber(numAsHex(askForTransit.transaction_vout)),
            },
            {
              type: balancedChannelKeyTypes.funding_signature,
              value: fundingSignature,
            },
            {
              type: balancedChannelKeyTypes.transit_public_key,
              value: args.transit_public_key,
            },
          ],
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
        return asyncRetry({interval, times}, cbk => {
          args.logger.info({waiting_for_incoming_channel: true});

          return getPendingChannels({lnd: args.lnd}, (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            // Look for the incoming channel proposal
            const pending = res.pending_channels.find(chan => {
              if (chan.transaction_vout !== fundingTx.transaction_vout) {
                return false;
              }

              if (!chan.is_opening) {
                return false;
              }

              if (chan.local_balance !== giveTokens(args.capacity)) {
                return false;
              }

              if (chan.partner_public_key !== args.partner_public_key) {
                return false;
              }

              return chan.transaction_id === fundingTx.transaction_id;
            });

            if (!pending) {
              return cbk([503, 'ExpectedIncomingPendingBalancedChannel']);
            }

            return cbk(null, {
              transaction_id: fundingTx.transaction_id,
              transaction_vout: fundingTx.transaction_vout,
              transactions: [askForTransit.transaction],
            });
          });
        },
        cbk);
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
