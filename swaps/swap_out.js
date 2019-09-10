const {createHash} = require('crypto');

const {addressForScript} = require('goldengate');
const asyncAuto = require('async/auto');
const asyncTimesSeries = require('async/timesSeries');
const {attemptSweep} = require('goldengate');
const {checkQuote} = require('goldengate');
const {checkSwapTiming} = require('goldengate');
const {createChainAddress} = require('ln-service');
const {createSwapOut} = require('goldengate');
const {decodeSwapRecovery} = require('goldengate');
const {encodeSwapRecovery} = require('goldengate');
const {decodePaymentRequest} = require('ln-service');
const {findDeposit} = require('goldengate');
const {getChainFeeRate} = require('ln-service');
const {getChannels} = require('ln-service');
const {getHeight} = require('goldengate');
const {getNode} = require('ln-service');
const {getPayment} = require('ln-service');
const {getSwapOutQuote} = require('goldengate');
const {getWalletInfo} = require('ln-service');
const {lightningLabsSwapService} = require('goldengate');
const moment = require('moment');
const {payViaPaymentRequest} = require('ln-service');
const {payViaRoutes} = require('ln-service');
const request = require('request');
const {returnResult} = require('asyncjs-util');
const {subscribeToBlocks} = require('ln-service');
const {subscribeToPastPayment} = require('ln-service');
const {subscribeToPayViaRequest} = require('ln-service');
const {subscribeToProbe} = require('ln-service');
const {Transaction} = require('bitcoinjs-lib');

const {authenticatedLnd} = require('./../lnd');
const {chains} = require('./../network/networks');
const {currencySymbols} = require('./../network/networks');
const {estimatedSweepVbytes} = require('./constants');
const {feeRateDenominator} = require('./constants');
const {fuzzBlocks} = require('./constants');
const {maxCltvExpiration} = require('./constants');
const {maxExecutionFeeTokens} = require('./constants');
const {maxFeeMultiplier} = require('./constants');
const {maxFeeRate} = require('./constants');
const {maxPathfindingMs} = require('./constants');
const {maxRouteFailProbability} = require('./constants');
const {maxRoutingFeeDenominator} = require('./constants');
const {minCltvDelta} = require('./constants');
const {minConfs} = require('./constants');
const {minSweepConfs} = require('./constants');
const {minutesPerBlock} = require('./constants');
const {requiredBufferBlocks} = require('./constants');
const {swappable} = require('./../network/networks');
const {sweepProgressLogDelayMs} = require('./constants');

const {ceil} = Math;
const {floor} = Math;
const {keys} = Object;
const {max} = Math;
const maxCltvDelta = 144 * 30;
const {min} = Math;
const mtokPerTok = BigInt(1000);
const numberFromBig = big => parseInt(big.toString(), 10);
const reversedBytes = hex => Buffer.from(hex, 'hex').reverse().toString('hex');
const {round} = Math;
const sha256 = n => createHash('sha256').update(Buffer.from(n, 'hex'));
const tokensAsBigUnit = tokens => (tokens / 1e8).toFixed(8);

/** Get additional inbound liquidity

  {
    confs: <Confirmations to Wait for Deposit Number>
    [is_dry_run]: <Avoid Actually Executing Operation Bool>
    [is_raw_recovery_shown]: <Show Raw Recovery Transactions Bool>
    logger: <Winston Logger Object>
    [max_fee]: <Maximum Fee Tokens Number>
    [max_wait_blocks]: <Maximum Wait Blocks Number>
    [node]: <Node Name String>
    [out_address]: <Out Address String>
    [peer]: <Peer Public Key Hex String>
    [recovery]: <Recover In-Progress Swap Hex String>
    timeout: <Wait for Deposit Timeout Milliseconds Number>
    tokens: <Tokens Number>
  }

  @returns via cbk
  {}
*/
module.exports = (args, cbk) => {
  return asyncAuto({
    // Recovery
    recover: cbk => {
      if (!args.recovery) {
        return cbk();
      }

      return decodeSwapRecovery({recovery: args.recovery}, cbk);
    },

    // Check arguments
    validate: ['recover', ({}, cbk) => {
      if (args.confs === undefined) {
        return cbk([400, 'ExpectedConfirmationsCountToConsiderReorgSafe']);
      }

      if (!args.logger) {
        return cbk([400, 'ExpectedLoggerForSwapProgressNotifications']);
      }

      if (!args.timeout) {
        return cbk([400, 'ExpectedTimeoutToWaitForSwapDeposit']);
      }

      if (!args.recovery && !args.tokens) {
        return cbk([400, 'ExpectedTokensToIncreaseLiquidity']);
      }

      return cbk();
    }],

    // Get authenticated lnd connection
    getLnd: ['validate', ({}, cbk) => {
      return authenticatedLnd({node: args.node}, cbk);
    }],

    // Create a sweep address
    createAddress: ['getLnd', 'recover', ({getLnd, recover}, cbk) => {
      if (!!recover && recover.sweep_address) {
        return cbk(null, {address: recover.sweep_address});
      }

      if (!!args.out_address) {
        return cbk(null, {address: args.out_address});
      }

      return createChainAddress({
        format: 'p2wpkh',
        is_unused: true,
        lnd: getLnd.lnd,
      },
      cbk);
    }],

    // Get channels
    getChannels: ['getLnd', ({getLnd}, cbk) => {
      return getChannels({lnd: getLnd.lnd, is_active: true}, cbk);
    }],

    // Get wallet info
    getWalletInfo: ['getLnd', ({getLnd}, cbk) => {
      return getWalletInfo({lnd: getLnd.lnd}, cbk);
    }],

    // Get the current block height
    getHeight: ['getWalletInfo', ({getWalletInfo}, cbk) => {
      return cbk(null, getWalletInfo.current_block_height);
    }],

    // Figure out which channel to use when swapping
    channel: ['getChannels', 'getLnd', ({getChannels, getLnd}, cbk) => {
      if (!!args.recovery) {
        return cbk();
      }

      const [channel] = getChannels.channels.filter(channel => {
        if (channel.local_balance < args.tokens) {
          return false;
        }

        return !args.peer ? true : channel.partner_public_key === args.peer;
      });

      // There was no channel found
      if (!channel) {
        return cbk([400, 'InsufficientOutboundLiquidityToConvertToInbound']);
      }

      const {id} = channel;

      // There is no channel with sufficient liquidity for the swap
      if (!id) {
        return cbk([400, 'InsufficientOutboundLiquidityToConvertToInbound']);
      }

      const peerChannels = getChannels.channels.filter(chan => {
        return chan.partner_public_key === channel.partner_public_key;
      });

      return getNode({
        is_omitting_channels: true,
        lnd: getLnd.lnd,
        public_key: channel.partner_public_key,
      },
      (err, res) => {
        if (!!err) {
          return cbk(err);
        }

        return cbk(null, {
          alias: res.alias,
          id: !!args.peer ? id : undefined,
          peer_channels: peerChannels,
          public_key: channel.partner_public_key,
        });
      });
    }],

    // Get start height
    getStartHeight: [
      'getWalletInfo',
      'recover',
      ({getWalletInfo, recover}, cbk) =>
    {
      if (!!recover) {
        return cbk(null, recover.start_height);
      }

      return cbk(null, getWalletInfo.current_block_height);
    }],

    // Network for swap
    network: ['getWalletInfo', ({getWalletInfo}, cbk) => {
      const [chain, otherChain] = getWalletInfo.chains;

      if (!!otherChain) {
        return cbk([400, 'CannotDetermineSwapChainFromNode']);
      }

      const network = keys(chains).find(network => {
        return chain === reversedBytes(chains[network]);
      });

      if (!network) {
        return cbk([400, 'UnknownChainForSwap']);
      }

      if (!swappable[network]) {
        return cbk([400, 'UnsupportedNetworkForSwapExecution']);
      }

      return cbk(null, network);
    }],

    // Currency of swap
    currency: ['network', ({network}, cbk) => {
      return cbk(null, currencySymbols[network]);
    }],

    // Swap service
    service: ['network', ({network}, cbk) => {
      try {
        return cbk(null, lightningLabsSwapService({network}).service);
      } catch (err) {
        return cbk([400, 'FailedToFindSupportedSwapService', {err}]);
      }
    }],

    // Recover address
    recoverAddress: ['network', 'recover', ({network, recover}, cbk) => {
      if (!args.recovery) {
        return cbk();
      }

      try {
        const {address} = addressForScript({network, script: recover.script});

        return cbk(null, address);
      } catch (err) {
        return cbk([400, 'FailedToDeriveSwapAddress', {err}]);
      }
    }],

    // Get the quote for swaps
    getQuote: ['service', ({service}, cbk) => {
      if (!!args.recovery) {
        return cbk();
      }

      return getSwapOutQuote({service}, cbk);
    }],

    // Check quote
    checkQuote: ['getQuote', ({getQuote}, cbk) => {
      if (!!args.recovery) {
        return cbk();
      }

      try {
        checkQuote({
          base_fee: getQuote.base_fee,
          cltv_delta: getQuote.cltv_delta,
          deposit: getQuote.deposit,
          fee_rate: getQuote.fee_rate,
          max_deposit: round(args.tokens * maxFeeRate),
          max_fee: round(args.tokens * maxFeeRate),
          max_tokens: getQuote.max_tokens,
          min_cltv_delta: minCltvDelta,
          min_tokens: getQuote.min_tokens,
          tokens: args.tokens,
        });
      } catch (err) {
        return cbk([400, err.message]);
      }

      const bipFee = args.tokens * getQuote.fee_rate / feeRateDenominator;
      const fundConfs = (args.confs || minConfs);
      const sweepConfs = (args.confs || minConfs);

      const allFees = getQuote.base_fee + bipFee;
      const swapMinimumMinutes = (fundConfs + sweepConfs) * minutesPerBlock;
      const swapTimeoutMinutes = getQuote.cltv_delta * minutesPerBlock;

      const fastestSwapTime = moment().add(swapMinimumMinutes, 'minutes');
      const swapTimeout = moment().add(swapTimeoutMinutes, 'minutes');

      args.logger.info({
        estimated_time: {
          start_at: moment().calendar(),
          earliest_completion: fastestSwapTime.fromNow(),
          forfeit_funds_deadline_at: swapTimeout.fromNow(),
        },
      });

      return cbk(null, {deposit: getQuote.deposit, service_fee: allFees});
    }],

    // Make sweep
    initiateSwap: [
      'checkQuote',
      'network',
      'recover',
      'recoverAddress',
      'service',
      ({network, recover, recoverAddress, service}, cbk) =>
    {
      if (!!args.recovery) {
        return cbk(null, {
          address: recoverAddress,
          private_key: recover.claim_private_key,
          script: recover.script,
          secret: recover.secret,
          start_height: recover.start_height,
          timeout: recover.timeout,
        });
      }

      const tokens = args.tokens;

      return createSwapOut({network, service, tokens}, cbk);
    }],

    // Decode swap execution request
    decodeExecutionRequest: [
      'getLnd',
      'initiateSwap',
      ({getLnd, initiateSwap}, cbk) =>
    {
      if (!!args.recovery) {
        return cbk();
      }

      return decodePaymentRequest({
        lnd: getLnd.lnd,
        request: initiateSwap.swap_execute_request,
      },
      cbk);
    }],

    // Check swap
    checkSwap: [
      'createAddress',
      'decodeExecutionRequest',
      'getHeight',
      'getWalletInfo',
      'initiateSwap',
      ({
        createAddress,
        decodeExecutionRequest,
        getHeight,
        getWalletInfo,
        initiateSwap,
      }, cbk) =>
    {
      // Exit early when the swap is already started or is just a test run
      if (!!args.is_dry_run || !!args.recovery) {
        return cbk();
      }

      try {
        const {recovery} = encodeSwapRecovery({
          claim_private_key: initiateSwap.private_key,
          execution_id: decodeExecutionRequest.id,
          refund_public_key: initiateSwap.service_public_key,
          secret: initiateSwap.secret,
          start_height: getHeight,
          sweep_address: createAddress.address,
          timeout: initiateSwap.timeout,
          tokens: args.tokens,
        });

        args.logger.info({restart_recovery_secret: recovery.toString('hex')});
      } catch (err) {
        return cbk([500, 'UnexpectedErrorGeneratingRecoveryState', {err}]);
      }

      try {
        checkSwapTiming({
          current_block_height: getWalletInfo.current_block_height,
          required_buffer_blocks: requiredBufferBlocks,
          required_funding_confirmations: args.confs,
          required_sweep_confirmations: args.confs,
          timeout_height: initiateSwap.timeout,
        });
      } catch (err) {
        return cbk([503, 'InsufficientTimeAvailableToCompleteSwap', {err}]);
      }

      return cbk();
    }],

    // Decode funding request
    decodeFundingRequest: [
      'getLnd',
      'initiateSwap',
      ({getLnd, initiateSwap}, cbk) =>
    {
      if (!!args.recovery) {
        return cbk();
      }

      return decodePaymentRequest({
        lnd: getLnd.lnd,
        request: initiateSwap.swap_fund_request,
      },
      cbk);
    }],

    // Check payment requests
    checkRequestAmounts: [
      'decodeExecutionRequest',
      'decodeFundingRequest',
      'getQuote',
      ({decodeExecutionRequest, decodeFundingRequest, getQuote}, cbk) =>
    {
      if (!!args.recovery) {
        return cbk();
      }

      // Check that the no-strings-attached prepay is as quoted
      if (decodeExecutionRequest.tokens !== getQuote.deposit) {
        return cbk([503, 'UnexpectedUnilateralDepositTokensAmount']);
      }

      const baseFee = getQuote.base_fee;
      const feeRate = getQuote.fee_rate;

      const bipFee = floor(args.tokens * feeRate / feeRateDenominator);

      if (decodeFundingRequest.tokens > bipFee + baseFee + args.tokens) {
        return cbk([503, 'UnexpectedServiceCostForSwap']);
      }

      return cbk();
    }],

    // Probe for execution
    findRouteForExecution: [
      'decodeExecutionRequest',
      'getLnd',
      ({decodeExecutionRequest, getLnd}, cbk) =>
    {
      // Exit early when there is a swap recovery
      if (!!args.recovery) {
        return cbk();
      }

      // Exit early, probing out of a specific channel is not supported
      if (!!args.peer) {
        return cbk(null, {});
      }

      const sub = subscribeToProbe({
        cltv_delta: decodeExecutionRequest.cltv_delta,
        destination: decodeExecutionRequest.destination,
        ignore_probability_below: maxRouteFailProbability,
        lnd: getLnd.lnd,
        max_fee: maxExecutionFeeTokens,
        path_timeout_ms: maxPathfindingMs,
        routes: decodeExecutionRequest.routes,
        tokens: decodeExecutionRequest.tokens,
      });

      const finished = (err, route) => {
        sub.removeAllListeners();

        return cbk(err, route);
      };

      sub.once('end', () => finished([503, 'FailedToFindRouteToExecuteSwap']));

      sub.once('error', err => finished(err));

      sub.once('probe_success', ({route}) => finished(null, route));

      return;
    }],

    // Probe for funding
    findRouteForFunding: [
      'currency',
      'decodeFundingRequest',
      'getLnd',
      'getStartHeight',
      ({currency, decodeFundingRequest, getLnd, getStartHeight}, cbk) =>
    {
      if (!!args.recovery) {
        return cbk();
      }

      // Exit early, probing out of a specific channel is not supported
      if (!!args.peer) {
        return cbk(null, {});
      }

      const sub = subscribeToProbe({
        cltv_delta: decodeFundingRequest.cltv_delta,
        destination: decodeFundingRequest.destination,
        ignore_probability_below: maxRouteFailProbability,
        lnd: getLnd.lnd,
        max_fee: round(decodeFundingRequest.tokens / maxRoutingFeeDenominator),
        max_timeout_height: getStartHeight + maxCltvDelta,
        path_timeout_ms: maxPathfindingMs,
        routes: decodeFundingRequest.routes,
        tokens: decodeFundingRequest.tokens,
      });

      const finished = (err, route) => {
        sub.removeAllListeners();

        return cbk(err, route);
      };

      sub.once('end', () => finished([503, 'FailedToFindFundingRoute']));

      sub.once('error', err => finished(err));

      sub.once('probe_success', ({route}) => finished(null, route));

      sub.on('probing', ({route}) => {
        const fee = numberFromBig(BigInt(route.fee_mtokens) / mtokPerTok);

        const pathFee = `${tokensAsBigUnit(route.fee_mtokens)} ${currency}`;

        return args.logger.info({check_path_with_fee: pathFee});
      });

      return;
    }],

    // Get funding peer info
    getSwapPeer: [
      'channel',
      'findRouteForFunding',
      'getChannels',
      'getLnd',
      ({channel, findRouteForFunding, getChannels, getLnd}, cbk) =>
    {
      // Exit early when this is a recovery
      if (!!args.recovery) {
        return cbk();
      }

      // Exit early when a peer is specified
      if (!!args.peer) {
        return cbk(null, {
          alias: channel.alias,
          peer_channels: getChannels.channels.filter(channel => {
            return channel.partner_public_key === args.peer;
          }),
          public_key: channel.public_key,
        });
      }

      const [firstHop] = findRouteForFunding.hops;

      return getNode({
        is_omitting_channels: true,
        lnd: getLnd.lnd,
        public_key: firstHop.public_key,
      },
      (err, res) => {
        if (!!err) {
          return cbk(err);
        }

        return cbk(null, {
          alias: res.alias,
          peer_channels: getChannels.channels.filter(channel => {
            return channel.partner_public_key === firstHop.public_key;
          }),
          public_key: firstHop.public_key,
        });
      });
    }],

    // Get fee estimate for sweep
    getMinSweepFee: [
      'currency',
      'decodeExecutionRequest',
      'decodeFundingRequest',
      'findRouteForExecution',
      'findRouteForFunding',
      'getLnd',
      'getSwapPeer',
      'getQuote',
      ({
        currency,
        decodeExecutionRequest,
        decodeFundingRequest,
        findRouteForExecution,
        findRouteForFunding,
        getLnd,
        getSwapPeer,
        getQuote,
      }, cbk) =>
    {
      // Exit early when this is a recovery
      if (!!args.recovery) {
        return cbk();
      }

      const bipFee = args.tokens * getQuote.fee_rate / feeRateDenominator;
      const executionRoutingFee = findRouteForExecution.fee || 0;
      const executionSend = decodeExecutionRequest.tokens;
      const fundingRoutingFee = findRouteForFunding.fee || 0;
      const fundingSend = decodeFundingRequest.tokens;
      const increase = `${tokensAsBigUnit(args.tokens)} ${currency}`;
      const peerIn = getSwapPeer.peer_channels.map(n => n.remote_balance);
      const peerOut = getSwapPeer.peer_channels.map(n => n.local_balance);
      const sumOf = tokens => tokens.reduce((sum, n) => sum + n, 0);

      const routingFees = executionRoutingFee + fundingRoutingFee;
      const serviceFee = floor(getQuote.base_fee + bipFee);

      return getChainFeeRate({
        confirmation_target: getQuote.cltv_delta,
        lnd: getLnd.lnd,
      },
      (err, res) => {
        if (!!err) {
          return cbk(err);
        }

        const sweepFee = res.tokens_per_vbyte * estimatedSweepVbytes;

        const allFees = ceil(getQuote.base_fee+bipFee+sweepFee+routingFees);

        if (!!args.max_fee && allFees > args.max_fee) {
          return cbk([400, 'MaxFeeTooLowToExecuteSwap', {needed: allFees}]);
        }

        args.logger.info({
          inbound_liquidity_increase: increase,
          with_peer: `${getSwapPeer.alias} ${getSwapPeer.public_key}`,
          swap_service_fee: `${tokensAsBigUnit(serviceFee)} ${currency}`,
          estimated_total_fee: `${tokensAsBigUnit(allFees)} ${currency}`,
          peer_inbound: `${tokensAsBigUnit(sumOf(peerIn))} ${currency}`,
          peer_outbound: `${tokensAsBigUnit(sumOf(peerOut))} ${currency}`,
        });

        if (!!args.is_dry_run) {
          return cbk([500, 'InboundLiquidityIncreaseDryRun']);
        }

        return cbk();
      });
    }],

    // Pay to swap funding
    payToFund: [
      'channel',
      'checkRequestAmounts',
      'checkSwap',
      'decodeFundingRequest',
      'findRouteForExecution',
      'findRouteForFunding',
      'getLnd',
      'getStartHeight',
      'getQuote',
      'initiateSwap',
      ({
        channel,
        decodeFundingRequest,
        findRouteForFunding,
        getLnd,
        getStartHeight,
        getQuote,
        initiateSwap,
      }, cbk) =>
    {
      if (!!args.recovery) {
        return cbk();
      }

      if (!args.peer) {
        return payViaRoutes({
          id: decodeFundingRequest.id,
          lnd: getLnd.lnd,
          routes: [findRouteForFunding],
        },
        cbk);
      }

      args.logger.info({paying_funding_request: decodeFundingRequest.id});

      const maxFee = min(
        round(decodeFundingRequest.tokens / maxRoutingFeeDenominator),
        args.max_fee || Infinity
      );

      return payViaPaymentRequest({
        lnd: getLnd.lnd,
        max_fee: maxFee,
        max_timeout_height: getStartHeight + maxCltvExpiration,
        outgoing_channel: channel.id,
        pathfinding_timeout: maxPathfindingMs,
        request: initiateSwap.swap_fund_request,
      },
      cbk);
    }],

    // Pay to swap execution
    payToExecute: [
      'channel',
      'checkRequestAmounts',
      'checkSwap',
      'decodeExecutionRequest',
      'findRouteForExecution',
      'findRouteForFunding',
      'getLnd',
      'getMinSweepFee',
      'getQuote',
      'getStartHeight',
      'initiateSwap',
      ({
        channel,
        decodeExecutionRequest,
        getLnd,
        getQuote,
        getStartHeight,
        initiateSwap,
      }, cbk) =>
    {
      if (!!args.recovery) {
        return cbk();
      }

      args.logger.info({paying_execution_request: decodeExecutionRequest.id});

      const sub = subscribeToPayViaRequest({
        lnd: getLnd.lnd,
        max_fee: maxExecutionFeeTokens,
        max_timeout_height: getStartHeight + maxCltvExpiration,
        outgoing_channel: channel.id || undefined,
        pathfinding_timeout: maxPathfindingMs,
        request: initiateSwap.swap_execute_request,
      });

      const finished = (err, res) => {
        sub.removeAllListeners();

        return cbk(err, res);
      };

      sub.once('end', () => finished([503, 'FailedToResolveSwapExecution']));

      sub.once('error', err => {
        return finished([503, 'UnexpectedErrorPayingFundingRequest', {err}]);
      });

      sub.once('confirmed', ({mtokens}) => finished(null, {mtokens}));

      sub.once('failed', failed => {
        switch (failed.is_pathfinding_timeout) {
        case false:
          return finished([503, 'InsufficientOutboundLiquidityToSwapService']);

        case true:
          return finished([503, 'TimedOutFindingALightningRoute']);

        default:
          return finished([500, 'UnexpectedOutcomeOfSwapFailure']);
        }
      });
    }],

    // Look for deposit in mempool
    findInMempool: [
      'getStartHeight',
      'initiateSwap',
      'network',
      'payToExecute',
      'recover',
      ({getStartHeight, initiateSwap, network, recover}, cbk) =>
    {
      args.logger.info({waiting_for_swap_deposit_to: initiateSwap.address});

      return findDeposit({
        network,
        request,
        address: initiateSwap.address,
        after: getStartHeight - fuzzBlocks,
        confirmations: [].length,
        timeout: maxPathfindingMs,
        tokens: !!recover ? recover.tokens : args.tokens,
      },
      (err, res) => {
        if (!!err) {
          return cbk();
        }

        args.logger.info({swap_tx_confirming: res.transaction_id});

        return cbk();
      });
    }],

    // Look for deposit
    findDeposit: [
      'getLnd',
      'getWalletInfo',
      'initiateSwap',
      'network',
      'recover',
      ({getWalletInfo, initiateSwap, getLnd, network, recover}, cbk) =>
    {
      const currentHeight = getWalletInfo.current_block_height;
      const sub = subscribeToBlocks({lnd: getLnd.lnd});
      const tokens = !recover ? args.tokens : recover.tokens;

      const startHeight = !recover ? currentHeight : recover.start_height;

      sub.on('block', ({height}, cbk) => {
        if (height <= currentHeight) {
          return;
        }

        return args.logger.info({blocks_waited: height - currentHeight});
      });

      sub.on('error', err => args.logger.error({block_subscription: err}));

      return findDeposit({
        network,
        tokens,
        address: initiateSwap.address,
        after: startHeight - fuzzBlocks,
        confirmations: args.confs,
        lnd: getLnd.lnd,
        timeout: args.timeout,
      },
      (err, res) => {
        sub.removeAllListeners();

        return cbk(err, res);
      });
    }],

    // Check deposit
    checkDeposit: ['findDeposit', ({findDeposit}, cbk) => {
      if (!!args.recovery) {
        return cbk();
      }

      if (findDeposit.output_tokens < args.tokens) {
        return cbk([503, 'ExpectedLargerDepositForSwapFundingDeposit']);
      }

      return cbk();
    }],

    // Claim details
    claim: [
      'findDeposit',
      'initiateSwap',
      ({findDeposit, initiateSwap}, cbk) =>
    {
      return cbk(null, {
        private_key: initiateSwap.private_key,
        script: initiateSwap.script,
        secret: initiateSwap.secret,
        timeout: initiateSwap.timeout,
        transaction_id: findDeposit.transaction_id,
        transaction_vout: findDeposit.transaction_vout,
      });
    }],

    // Raw recovery
    rawRecovery: [
      'claim',
      'createAddress',
      'getHeight',
      'getLnd',
      'initiateSwap',
      'network',
      'recover',
      ({
        claim,
        createAddress,
        getHeight,
        getLnd,
        initiateSwap,
        network,
        recover,
      }, cbk) =>
    {
      // Exit early when the raw recovery option is not toggled
      if (!args.is_raw_recovery_shown) {
        return cbk();
      }

      const blocksUntilTimeout = initiateSwap.timeout - getHeight;
      const maxWaitBlocks = args.max_wait_blocks || Number.MAX_SAFE_INTEGER;
      let minFeeRate;
      const tokens = !recover ? args.tokens : recover.tokens;

      const maxSafeHeight = initiateSwap.timeout - args.confs;
      const maxWaitHeight = getHeight + maxWaitBlocks;

      asyncTimesSeries(blocksUntilTimeout, (i, cbk) => {
        return attemptSweep({
          network,
          tokens,
          current_height: getHeight + i,
          deadline_height: min(maxWaitHeight, maxSafeHeight),
          is_dry_run: true,
          lnd: getLnd.lnd,
          max_fee_multiplier: maxFeeMultiplier,
          min_fee_rate: minFeeRate,
          private_key: claim.private_key,
          secret: claim.secret,
          start_height: initiateSwap.start_height || getHeight,
          sweep_address: createAddress.address,
          transaction_id: claim.transaction_id,
          transaction_vout: claim.transaction_vout,
          witness_script: claim.script,
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          args.logger.info({
            fee_rate: res.fee_rate,
            min_fee_rate: res.min_fee_rate,
            timelock_height: getHeight + i,
            transaction: res.transaction,
          });

          minFeeRate = res.min_fee_rate;

          return cbk();
        });
      },
      cbk);
    }],

    // Execute the sweep
    sweep: [
      'claim',
      'createAddress',
      'getHeight',
      'getLnd',
      'initiateSwap',
      'network',
      'rawRecovery',
      'recover',
      ({
        claim,
        createAddress,
        getHeight,
        getLnd,
        initiateSwap,
        network,
        recover,
      }, cbk) =>
    {
      const blocksUntilTimeout = initiateSwap.timeout - getHeight;

      if (blocksUntilTimeout < args.confs) {
        return cbk([503, 'FailedToReceiveSwapFundingConfirmationInTime']);
      }

      args.logger.info({swap_deposit_confirmed: claim.transaction_id});

      const blocksSubscription = subscribeToBlocks({lnd: getLnd.lnd});
      const tokens = !recover ? args.tokens : recover.tokens;

      blocksSubscription.on('end', () => {});
      blocksSubscription.on('error', () => {});
      blocksSubscription.on('status', () => {});

      // On every block, attempt a sweep
      blocksSubscription.on('block', ({height}) => {
        return attemptSweep({
          network,
          request,
          tokens,
          current_height: height,
          deadline_height: initiateSwap.timeout - args.confs,
          lnd: getLnd.lnd,
          max_fee_multiplier: maxFeeMultiplier,
          private_key: claim.private_key,
          secret: claim.secret,
          start_height: getHeight,
          sweep_address: createAddress.address,
          transaction_id: claim.transaction_id,
          transaction_vout: claim.transaction_vout,
          witness_script: claim.script,
        },
        (err, res) => {
          return setTimeout(() => {
            // Exit early when the listener count is low
            if (!blocksSubscription.listenerCount('block')) {
              return;
            }

            if (!!err) {
              return args.logger.error({
                message: 'AttemptedSweep',
                spending: !!args.recovery ? claim.transaction_id : undefined,
              });
            }

            return args.logger.info({
              attempt_tx_id: Transaction.fromHex(res.transaction).getId(),
              attempting_sweep_fee_rate: res.fee_rate,
            });
          },
          sweepProgressLogDelayMs);
        });
      });

      return findDeposit({
        network,
        address: createAddress.address,
        after: getHeight,
        confirmations: max(args.confs, minSweepConfs),
        lnd: getLnd.lnd,
        timeout: args.timeout,
        transaction_id: claim.transaction_id,
        transaction_vout: claim.transaction_vout,
      },
      (err, res) => {
        blocksSubscription.removeAllListeners();

        if (!!err) {
          return cbk(err);
        }

        return cbk(null, {output_tokens: res.output_tokens});
      });
    }],

    // Get funding payment
    getFundingPayment: [
      'decodeFundingRequest',
      'getLnd',
      'payToFund',
      'recover',
      'sweep',
      ({decodeFundingRequest, getLnd, recover}, cbk) =>
    {
      const fundingRequest = decodeFundingRequest || {};

      const id = fundingRequest.id || sha256(recover.secret).digest('hex');

      const sub = subscribeToPastPayment({id, lnd: getLnd.lnd});

      const finished = (err, res) => {
        sub.removeAllListeners();

        return cbk(err, res);
      };

      sub.once('confirmed', payment => finished(null, {payment}));

      sub.once('failed', failed => {
        if (!!failed.is_pathfinding_timeout) {
          return cbk([503, 'TimedOutTryingToFindPathToSwapService']);
        }

        return cbk([503, 'UnableToFindAnyPathToSwapService']);
      });

      return;
    }],

    // Get execution payment
    getExecutionPayment: [
      'decodeExecutionRequest',
      'getLnd',
      'payToExecute',
      'recover',
      ({decodeExecutionRequest, getLnd, recover}, cbk) =>
    {
      const executionRequest = decodeExecutionRequest || {};

      const id = executionRequest.id || recover.execution_id;

      return getPayment({id, lnd: getLnd.lnd}, cbk);
    }],

    // Spent offchain
    spentOffchain: [
      'getExecutionPayment',
      'getFundingPayment',
      ({getExecutionPayment, getFundingPayment}, cbk) =>
    {
      const executionPayment = getExecutionPayment.payment || {};
      const fundingPayment = getFundingPayment.payment || {};

      const spentOnPrepay = BigInt(executionPayment.mtokens || '0');
      const spentOnFunding = BigInt(fundingPayment.mtokens || '0');

      const spentOffchain = spentOnPrepay + spentOnFunding;

      const executionFee = BigInt(executionPayment.fee_mtokens);
      const fundingFee = BigInt(fundingPayment.fee_mtokens);

      return cbk(null, {
        fee: (BigInt(executionFee) + BigInt(fundingFee)).toString(),
        spent: spentOffchain.toString(),
      });
    }],

    // Finished
    summary: [
      'currency',
      'sweep',
      'recover',
      'spentOffchain',
      ({currency, sweep, recover, spentOffchain}, cbk) =>
    {
      const amountReceived = BigInt(sweep.output_tokens) * mtokPerTok;
      const offchainFee = (BigInt(spentOffchain.fee) / mtokPerTok);
      const spentOffchainMtokens = BigInt(spentOffchain.spent);
      const tokens = !recover ? args.tokens : recover.tokens;

      const chainFee = tokens - sweep.output_tokens;
      const liquidityIncrease = (spentOffchainMtokens / mtokPerTok);
      const routingFeeTokens = numberFromBig(offchainFee);
      const swapFeeMtokens = BigInt(spentOffchain.spent) - amountReceived;

      const increase = tokensAsBigUnit(numberFromBig(liquidityIncrease));
      const swapFee = numberFromBig(swapFeeMtokens / mtokPerTok);

      args.logger.info({
        inbound_liquidity_increase: `${increase} ${currency}`,
        swap_completed_at: moment().calendar(),
        chain_fee_paid: `${tokensAsBigUnit(chainFee)} ${currency}`,
        routing_fee_paid: `${tokensAsBigUnit(routingFeeTokens)} ${currency}`,
        total_fee_paid: `${tokensAsBigUnit(swapFee)} ${currency}`,
      });

      return cbk(null, {is_complete: true});
    }],
  },
  returnResult({}, cbk));
};
