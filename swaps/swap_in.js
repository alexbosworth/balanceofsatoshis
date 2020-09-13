const {addressForScript} = require('goldengate');
const asyncAuto = require('async/auto');
const {broadcastTransaction} = require('goldengate');
const {createChainAddress} = require('ln-service');
const {createInvoice} = require('ln-service');
const {createSwapIn} = require('goldengate');
const {decodeSwapRecovery} = require('goldengate');
const {encodeSwapRecovery} = require('goldengate');
const {findDeposit} = require('goldengate');
const {findSecret} = require('goldengate');
const {getChainFeeRate} = require('goldengate');
const {getInvoice} = require('ln-service');
const {getSwapInQuote} = require('goldengate');
const {getSwapInTerms} = require('goldengate');
const {getWalletInfo} = require('ln-service');
const {lightningLabsSwapService} = require('goldengate');
const moment = require('moment');
const qrcode = require('qrcode-terminal');
const {refundTransaction} = require('goldengate');
const request = require('@alexbosworth/request');
const {returnResult} = require('asyncjs-util');
const {subscribeToBlocks} = require('goldengate');
const {subscribeToInvoice} = require('ln-service');
const {subscribeToSwapInStatus} = require('goldengate');
const {swapInFee} = require('goldengate');

const {authenticatedLnd} = require('./../lnd');
const {getLiquidity} = require('./../balances');
const {getNetwork} = require('./../network');
const getPaidService = require('./get_paid_service');

const bigFormat = tokens => ((tokens || 0) / 1e8).toFixed(8);
const msPerBlock = 1000 * 60 * 10;
const msPerYear = 1000 * 60 * 60 * 24 * 365;
const {now} = Date;
const waitForDepositMs = 1000 * 60 * 60 * 24;

/** Receive funds on-chain

  {
    [api_key]: <API Key CBOR Hex String>
    [in_through]: <Request Inbound Payment Public Key Hex String>
    [is_refund_test]: <Alter Swap Timeout To Have Short Refund Bool>
    lnd: <Authenticated LND gRPC API Object>
    logger: <Logger Object>
    [max_fee]: <Maximum Fee Tokens to Pay Number>
    [recovery]: <Recover In-Progress Swap String>
    [refund_address]: <Refund Address String>
    [tokens]: <Tokens Number>
  }

  @returns via cbk
  {
    address: <Address String>
  }
*/
module.exports = (args, cbk) => {
  let isSuccessfulSwap = false;

  return asyncAuto({
    // Check arguments
    validate: cbk => {
      if (!args.logger) {
        return cbk([400, 'ExpectedLoggerToReceiveOnChain']);
      }

      if (!args.lnd) {
        return cbk([400, 'ExpectedLndToReceiveOnChain']);
      }

      if (!args.tokens && !args.recovery) {
        return cbk([400, 'ExpectedTokensAmountToReceiveOnChain']);
      }

      return cbk();
    },

    // Get the best block height at the start of the swap
    getInfo: ['validate', ({}, cbk) => getWalletInfo({lnd: args.lnd}, cbk)],

    // Get channels
    getLiquidity: ['validate', ({}, cbk) => {
      // Exit early when recovering from an existing swap
      if (!!args.recovery) {
        return cbk();
      }

      return getLiquidity({
        above: args.tokens,
        is_top: true,
        lnd: args.lnd,
      },
      cbk);
    }],

    // Get the network this swap takes place on
    getNetwork: ['validate', ({}, cbk) => getNetwork({lnd: args.lnd}, cbk)],

    // Upgrade service object to a paid service if necessary
    getService: ['getLiquidity', 'getNetwork', ({}, cbk) => {
      // Exit early when we're recovering an existing swap
      if (!!args.recovery && !args.api_key) {
        return cbk();
      }

      return getPaidService({
        lnd: args.lnd,
        logger: args.logger,
        token: args.api_key,
      },
      cbk);
    }],

    // Get quote for a swap
    getQuote: [
      'getLiquidity',
      'getService',
      ({getLiquidity, getService}, cbk) =>
    {
      // Exit early when recovering an existing swap
      if (!!args.recovery) {
        return cbk();
      }

      // Exit early when there is insufficient inbound liquidity
      if (!getLiquidity.balance) {
        return cbk([400, 'InsufficientInboundLiquidityToReceiveSwapOffchain']);
      }

      return getSwapInQuote({
        service: getService.service,
        tokens: args.tokens,
      },
      cbk);
    }],

    // Create an invoice
    createInvoice: ['getLimits', 'getQuote', ({getLimits, getQuote}, cbk) => {
      // Exit early when we're recovering an existing swap
      if (!!args.recovery) {
        return (async () => {
          try {
            const {id} = await decodeSwapRecovery({recovery: args.recovery});

            return getInvoice({id, lnd: args.lnd}, cbk);
          } catch (err) {
            return cbk([400, 'FailedToDecodeSwapRecovery', {err}]);
          }
        })();
      }

      if (args.tokens > getLimits.max_tokens) {
        return cbk([400, 'AmountTooHighToSwap', {max: getLimits.max_tokens}]);
      }

      if (args.tokens < getLimits.min_tokens) {
        return cbk([400, 'AmountTooLowToSwap', {min: getLimits.min_tokens}]);
      }

      const {fee} = getQuote;

      if (!!args.max_fee && fee > args.max_fee) {
        return cbk([400, 'MaxFeeExceededForSwap', {required_fee: fee}]);
      }

      return createInvoice({
        description: `Submarine swap. Service fee: ${fee}`,
        expires_at: new Date(now() + msPerYear).toISOString(),
        is_including_private_channels: true,
        lnd: args.lnd,
        tokens: args.tokens - fee,
      },
      cbk);
    }],

    // Get the limits for a swap
    getLimits: ['getService', ({getService}, cbk) => {
      // Exit early when recovering an existing swap
      if (!!args.recovery) {
        return cbk();
      }

      return getSwapInTerms({service: getService.service}, cbk);
    }],

    // Initiate the swap
    createSwap: [
      'createInvoice',
      'getQuote',
      'getService',
      ({createInvoice, getQuote, getService}, cbk) =>
    {
      // Exit early when we're recovering an existing swap
      if (!!args.recovery) {
        return cbk();
      }

      if (!!getService.paid && !!getService.token) {
        args.logger.info({
          amount_paid_for_api_key: bigFormat(getService.paid),
          service_api_key: getService.token,
        });
      }

      return createSwapIn({
        fee: getQuote.fee,
        in_through: args.in_through,
        macaroon: getService.macaroon,
        preimage: getService.preimage,
        request: createInvoice.request,
        service: getService.service,
      },
      cbk);
    }],

    // Swap details
    swap: [
      'createSwap',
      'getInfo',
      'getNetwork',
      async ({createSwap, getInfo, getNetwork}) =>
    {
      // Exit early when no swap is taking place
      if (!args.recovery && !createSwap) {
        return;
      }

      const {network} = getNetwork;

      // Exit early when recovery details are specified
      if (!!args.recovery) {
        const recovery = await decodeSwapRecovery({recovery: args.recovery});

        const {address} = addressForScript({network, script: recovery.script});

        return {
          address,
          claim_public_key: recovery.claim_public_key,
          id: recovery.id,
          refund_private_key: recovery.refund_private_key,
          script: recovery.script,
          start_height: recovery.start_height,
          timeout: recovery.timeout,
          tokens: recovery.tokens,
          version: recovery.version,
        };
      }

      const isTest = !!args.is_refund_test;

      const cltv = !isTest ? createSwap.timeout : getInfo.current_block_height;

      return {
        address: createSwap.address,
        claim_public_key: createSwap.service_public_key,
        id: createSwap.id,
        refund_private_key: createSwap.private_key,
        script: createSwap.script,
        start_height: getInfo.current_block_height,
        timeout: cltv,
        tokens: createSwap.tokens,
        version: createSwap.version,
      };
    }],

    // Create a regular address
    chainAddress: ['swap', ({swap}, cbk) => {
      return createChainAddress({
        format: 'p2wpkh',
        is_unused: true,
        lnd: args.lnd,
      },
      cbk);
    }],

    // Recovery
    recovery: ['getInfo', 'swap', ({getInfo, swap}, cbk) => {
      if (!!args.recovery || !swap) {
        return cbk();
      }

      try {
        const {recovery} = encodeSwapRecovery({
          claim_public_key: swap.claim_public_key,
          id: swap.id,
          refund_private_key: swap.refund_private_key,
          start_height: getInfo.current_block_height,
          timeout: swap.timeout,
          tokens: swap.tokens,
          version: swap.version,
        });

        return cbk(null, recovery);
      } catch (err) {
        return cbk([500, 'FailedToGenerateSwapRecovery', {err}])
      }
    }],

    // Find in deposit in mempool
    findDepositInMempool: [
      'createInvoice',
      'getNetwork',
      'swap',
      ({createInvoice, getNetwork, swap}, cbk) =>
    {
      // Exit early when there is no outstanding invoice
      if (!createInvoice || !!createInvoice.is_confirmed) {
        return cbk();
      }

      return findDeposit({
        request,
        address: swap.address,
        after: swap.start_height,
        confirmations: [].length,
        network: getNetwork.network,
        timeout: waitForDepositMs,
        tokens: swap.tokens,
      },
      (err, res) => {
        if (!!err) {
          return cbk();
        }

        args.logger.info({waiting_for_confirmation_of_tx: res.transaction_id});

        return cbk();
      });
    }],

    // Find deposit
    findDeposit: [
      'createInvoice',
      'getNetwork',
      'swap',
      ({createInvoice, getNetwork, swap}, cbk) =>
    {
      if (!createInvoice || !!createInvoice.is_confirmed) {
        return cbk();
      }

      return findDeposit({
        address: swap.address,
        after: swap.start_height,
        confirmations: [].length,
        lnd: args.lnd,
        network: getNetwork.network,
        timeout: waitForDepositMs,
        tokens: swap.tokens,
      },
      cbk);
    }],

    // Get chain fee rate
    getFeeRate: ['swap', ({swap}, cbk) => {
      return getChainFeeRate({
        confirmation_target: swap.timeout,
        lnd: args.lnd,
      },
      cbk);
    }],

    // Refund transaction
    refund: [
      'chainAddress',
      'findDeposit',
      'getFeeRate',
      'getNetwork',
      'swap',
      ({chainAddress, findDeposit, getFeeRate, getNetwork, swap}, cbk) =>
    {
      if (!findDeposit || !!isSuccessfulSwap) {
        return cbk();
      }

      const {transaction} = refundTransaction({
        block_height: swap.timeout,
        fee_tokens_per_vbyte: getFeeRate.tokens_per_vbyte,
        is_nested: false,
        network: getNetwork.network,
        private_key: swap.refund_private_key,
        sweep_address: args.refund_address || chainAddress.address,
        tokens: swap.tokens,
        transaction_id: findDeposit.transaction_id,
        transaction_vout: findDeposit.transaction_vout,
        witness_script: swap.script,
      });

      args.logger.info({
        refund_height: swap.timeout,
        refund_transaction: transaction,
      });

      return cbk(null, transaction);
    }],

    // Broadcast refund transaction
    broadcastRefund: [
      'findDepositInMempool',
      'getInfo',
      'refund',
      'swap',
      ({getInfo, refund, swap}, cbk) =>
    {
      if (!args.recovery || !refund) {
        return cbk();
      }

      const blocks = swap.timeout - getInfo.current_block_height;

      if (blocks > [].length) {
        args.logger.info({
          refund_possible: moment(now() + msPerBlock * blocks).fromNow(),
          blocks_left_until_refund_can_be_broadcast: blocks,
        });

        return cbk();
      }

      return broadcastTransaction({lnd: args.lnd, transaction: refund}, cbk);
    }],

    // Refund broadcast
    refundBroadcast: [
      'broadcastRefund',
      'getInfo',
      'swap',
      ({broadcastRefund, getInfo, swap}, cbk) =>
    {
      if (!args.recovery || !broadcastRefund) {
        return cbk();
      }

      args.logger.info({
        refund_transaction_id: broadcastRefund.transaction_id,
      });

      return cbk();
    }],

    // Wait for payment
    waitForPayment: [
      'createInvoice',
      'getInfo',
      'getNetwork',
      'recovery',
      'swap',
      ({createInvoice, getInfo, getNetwork, recovery, swap}, cbk) =>
    {
      if (!createInvoice || !swap || !!args.recovery) {
        return cbk();
      }

      const expiryBlocks = swap.timeout - getInfo.current_block_height;
      let foundTx = false;
      const startHeight = getInfo.current_block_height;

      const url = `bitcoin:${swap.address}?amount=${bigFormat(args.tokens)}`;

      qrcode.generate(url, {small: true}, qr => {
        return args.logger.info({
          swap: {
            send_to_address: swap.address,
            send_exact_amount: bigFormat(args.tokens),
            send_to_qr: qr,
          },
          service_fee: args.tokens - createInvoice.tokens,
          refund_recovery_secret: recovery,
          timing: {
            earliest_completion: moment(now() + msPerBlock).fromNow(),
            refund_available: moment(now() + expiryBlocks*msPerBlock).fromNow(),
          },
        });
      });

      const sub = subscribeToInvoice({id: createInvoice.id, lnd: args.lnd});

      const finished = (err, res) => {
        sub.removeAllListeners();

        return cbk(err, res);
      };

      sub.on('error', err => finished(err));

      sub.on('invoice_updated', invoice => {
        if (!invoice.is_confirmed) {
          return;
        }

        isSuccessfulSwap = true;

        args.logger.info({
          swap_successful: {
            completed: moment(invoice.confirmed_at).calendar(),
            received_offchain: bigFormat(invoice.received),
            service_fee_paid: bigFormat(args.tokens - invoice.received),
          },
        });

        return finished();
      });

      return;
    }],
  },
  returnResult({}, cbk));
};
