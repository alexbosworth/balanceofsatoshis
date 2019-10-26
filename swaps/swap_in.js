const {addressForScript} = require('goldengate');
const asyncAuto = require('async/auto');
const asyncRetry = require('async/retry');
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
const {getWalletInfo} = require('ln-service');
const {lightningLabsSwapService} = require('goldengate');
const moment = require('moment');
const qrcode = require('qrcode-terminal');
const {refundTransaction} = require('goldengate');
const request = require('request');
const {returnResult} = require('asyncjs-util');
const {subscribeToBlocks} = require('goldengate');
const {subscribeToInvoice} = require('ln-service');
const {swapInFee} = require('goldengate');
const {swapScript} = require('goldengate');

const {authenticatedLnd} = require('./../lnd');
const {getLiquidity} = require('./../balances');
const {getNetwork} = require('./../network');

const bigFormat = tokens => (tokens / 1e8).toFixed(8);
const msPerBlock = 1000 * 60 * 10;
const msPerYear = 1000 * 60 * 60 * 24 * 365;
const {now} = Date;
const waitForDepositMs = 1000 * 60 * 60 * 24;

/** Receive funds on-chain

  {
    [is_refund_test]: <Alter Swap Timeout To Have Short Refund Bool>
    logger: <Logger Object>
    [max_fee]: <Maximum Fee Tokens to Pay Number>
    [node]: <Node Name String>
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

      if (!args.tokens && !args.recovery) {
        return cbk([400, 'ExpectedTokensAmountToReceiveOnChain']);
      }

      return cbk();
    },

    // Get channels
    getLiquidity: ['validate', ({}, cbk) => {
      // Exit early when recovering from an existing swap
      if (!!args.recovery) {
        return cbk();
      }

      return getLiquidity({
        above: args.tokens,
        is_top: true,
        node: args.node,
      },
      cbk);
    }],

    // Get authenticated lnd connection
    getLnd: ['validate', ({}, cbk) => {
      return authenticatedLnd({logger: args.logger, node: args.node}, cbk);
    }],

    // Get wallet info
    getInfo: ['getLnd', ({getLnd}, cbk) => {
      return getWalletInfo({lnd: getLnd.lnd}, cbk);
    }],

    // Get network
    getNetwork: ['getLnd', ({getLnd}, cbk) => {
      return getNetwork({lnd: getLnd.lnd}, cbk)
    }],

    // Swap service
    service: ['getNetwork', ({getNetwork}, cbk) => {
      const {network} = getNetwork;

      try {
        return cbk(null, lightningLabsSwapService({network}).service);
      } catch (err) {
        return cbk([500, 'FailedToInitiateSwapServiceConnection', {err}]);
      }
    }],

    // Get quote for a Loop In
    getQuote: ['getLiquidity', 'service', ({getLiquidity, service}, cbk) => {
      // Exit early when recovering an existing swap
      if (!!args.recovery) {
        return cbk();
      }

      // Exit early when there is insufficient inbound liquidity
      if (!getLiquidity.balance) {
        return cbk([400, 'InsufficientInboundLiquidityToReceiveSwapOffchain']);
      }

      return getSwapInQuote({service}, cbk);
    }],

    // Create an invoice
    createInvoice: ['getLnd', 'getQuote', ({getLnd, getQuote}, cbk) => {
      // Exit early when we're recovering an existing swap
      if (!!args.recovery) {
        return (async () => {
          const {id} = await decodeSwapRecovery({recovery: args.recovery});

          return getInvoice({id, lnd: getLnd.lnd}, cbk);
        })();
      }

      if (args.tokens < getQuote.min_tokens) {
        return cbk([400, 'AmountTooLowToSwap', {min: getQuote.min_tokens}]);
      }

      if (args.tokens > getQuote.max_tokens) {
        return cbk([400, 'AmountTooHighToSwap', {max: getQuote.max_tokens}]);
      }

      try {
        const {fee} = swapInFee({
          base_fee: getQuote.base_fee,
          fee_rate: getQuote.fee_rate,
          tokens: args.tokens,
        });

        if (!!args.max_fee && fee > args.max_fee) {
          return cbk([400, 'MaxFeeExceededForSwap', {required_fee: fee}]);
        }

        return createInvoice({
          description: `Submarine swap. Service fee: ${fee}`,
          expires_at: new Date(now() + msPerYear).toISOString(),
          is_including_private_channels: true,
          lnd: getLnd.lnd,
          tokens: args.tokens - fee,
        },
        cbk);
      } catch (err) {
        return cbk([500, 'UnexpectedFailureCreatingInvoice', {err}]);
      }
    }],

    // Initiate the swap
    createSwap: [
      'createInvoice',
      'getQuote',
      'service',
      ({createInvoice, getQuote, service}, cbk) =>
    {
      // Exit early when we're recovering an existing swap
      if (!!args.recovery) {
        return cbk();
      }

      return createSwapIn({
        service,
        base_fee: getQuote.base_fee,
        fee_rate: getQuote.fee_rate,
        request: createInvoice.request,
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

        return {
          address: addressForScript({network, script: recovery.script}).nested,
          claim_public_key: recovery.claim_public_key,
          id: recovery.id,
          refund_private_key: recovery.refund_private_key,
          script: recovery.script,
          start_height: recovery.start_height,
          timeout: recovery.timeout,
          tokens: recovery.tokens,
        };
      }

      const isTest = !!args.is_refund_test;

      const cltv = !isTest ? createSwap.timeout : getInfo.current_block_height;

      const {script} = swapScript({
        claim_public_key: createSwap.service_public_key,
        hash: createSwap.id,
        refund_private_key: createSwap.private_key,
        timeout: cltv,
      });

      const {nested} = addressForScript({network, script});

      return {
        script,
        address: nested,
        claim_public_key: createSwap.service_public_key,
        id: createSwap.id,
        refund_private_key: createSwap.private_key,
        start_height: getInfo.current_block_height,
        timeout: cltv,
        tokens: createSwap.tokens,
      };
    }],

    // Create a regular address
    chainAddress: ['getLnd', 'swap', ({getLnd, swap}, cbk) => {
      return createChainAddress({
        format: 'p2wpkh',
        is_unused: true,
        lnd: getLnd.lnd,
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
      'getLnd',
      'getNetwork',
      'swap',
      ({createInvoice, getLnd, getNetwork, swap}, cbk) =>
    {
      if (!createInvoice || !!createInvoice.is_confirmed) {
        return cbk();
      }

      return findDeposit({
        address: swap.address,
        after: swap.start_height,
        confirmations: [].length,
        lnd: getLnd.lnd,
        network: getNetwork.network,
        timeout: waitForDepositMs,
        tokens: swap.tokens,
      },
      cbk);
    }],

    // Get chain fee rate
    getFeeRate: ['getLnd', 'swap', ({getLnd, swap}, cbk) => {
      return getChainFeeRate({
        confirmation_target: swap.timeout,
        lnd: getLnd.lnd,
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
    broadcastRefund: ['getLnd', 'refund', ({getLnd, refund}, cbk) => {
      if (!args.recovery || !refund) {
        return cbk();
      }

      return broadcastTransaction({lnd: getLnd.lnd, transaction: refund}, cbk);
    }],

    // Refund broadcast
    refundBroadcast: [
      'broadcastRefund',
      'getInfo',
      'swap',
      ({broadcastRefund, getInfo, swap}, cbk) =>
    {
      if (!args.recovery) {
        return cbk();
      }

      // Exit early when a refund tx will not
      if (swap.timeout > getInfo.current_block_height) {
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
      'getLnd',
      'getNetwork',
      'recovery',
      'swap',
      ({createInvoice, getInfo, getLnd, getNetwork, recovery, swap}, cbk) =>
    {
      if (!createInvoice || !swap) {
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

      const sub = subscribeToInvoice({
        id: createInvoice.id,
        lnd: getLnd.lnd
      });

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
