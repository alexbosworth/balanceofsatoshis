const {createHash} = require('crypto');

const {addressForScript} = require('goldengate');
const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const asyncTimesSeries = require('async/timesSeries');
const {attemptSweep} = require('goldengate');
const {checkSwapTiming} = require('goldengate');
const {createChainAddress} = require('ln-service');
const {createSwapOut} = require('goldengate');
const {decodeSwapRecovery} = require('goldengate');
const {encodeSwapRecovery} = require('goldengate');
const {decodePaymentRequest} = require('ln-service');
const {findDeposit} = require('goldengate');
const {getChainFeeRate} = require('ln-service');
const {getChannels} = require('ln-service');
const {getNode} = require('ln-service');
const {getPayment} = require('ln-service');
const {getSwapOutQuote} = require('goldengate');
const {getSwapOutTerms} = require('goldengate');
const {getWalletInfo} = require('ln-service');
const {lightningLabsSwapService} = require('goldengate');
const moment = require('moment');
const {payViaRoutes} = require('ln-service');
const {releaseSwapOutSecret} = require('goldengate');
const request = require('@alexbosworth/request');
const {returnResult} = require('asyncjs-util');
const {subscribeToBlocks} = require('ln-service');
const {subscribeToPastPayment} = require('ln-service');
const {subscribeToPayViaRequest} = require('ln-service');
const {Transaction} = require('bitcoinjs-lib');

const {authenticatedLnd} = require('./../lnd');
const avoidsAsIgnores = require('./avoids_as_ignores');
const {chains} = require('./../network/networks');
const {currencySymbols} = require('./../network/networks');
const {estimatedSweepVbytes} = require('./constants');
const {executeProbe} = require('./../network');
const {fastDelayMinutes} = require('./constants');
const {feeRateDenominator} = require('./constants');
const {fuzzBlocks} = require('./constants');
const getRoutesForFunding = require('./get_routes_for_funding');
const {getNetwork} = require('./../network');
const getPaidService = require('./get_paid_service');
const getRawRecoveries = require('./get_raw_recoveries');
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
const {slowDelayMinutes} = require('./constants');
const {swappable} = require('./../network/networks');
const {sweepProgressLogDelayMs} = require('./constants');

const {ceil} = Math;
const changeTokens = 1e4;
const cltvBuffer = 3;
const flatten = arr => [].concat(...arr);
const {floor} = Math;
const {max} = Math;
const maxCltvDelta = 144 * 30;
const {min} = Math;
const mtokPerTok = BigInt(1000);
const {round} = Math;
const sha256 = n => createHash('sha256').update(Buffer.from(n, 'hex'));
const tokensAsBigUnit = tokens => ((tokens || 0) / 1e8).toFixed(8);

/** Get additional inbound liquidity

  {
    [api_key]: <API Key CBOR String>
    [avoid]: [<Avoid Forwarding Through Node With Public Key Hex String>]
    confs: <Confirmations to Wait for Deposit Number>
    [is_fast]: <Execute Swap Immediately Bool>
    [is_dry_run]: <Avoid Actually Executing Operation Bool>
    [is_raw_recovery_shown]: <Show Raw Recovery Transactions Bool>
    lnd: <Authenticated LND gRPC API Object>
    logger: <Winston Logger Object>
    [max_fee]: <Maximum Fee Tokens Number>
    [max_paths]: <Maximum Paths For Funding Number>
    [max_wait_blocks]: <Maximum Wait Blocks Number>
    [node]: <Node Name String>
    [out_address]: <Out Address String>
    [peer]: <Peer Public Key Hex String>
    [recovery]: <Recover In-Progress Swap Hex String>
    [socket]: <Custom Backing Service Host:Port String>
    [spend_address]: <Attempt Spend Out To Address String>
    [spend_tokens]: <Spend Address Exact Tokens Number>
    timeout: <Wait for Deposit Timeout Milliseconds Number>
    tokens: <Tokens Number>
  }

  @returns via cbk
  {}
*/
module.exports = (args, cbk) => {
  return asyncAuto({
    // Decode the swap recovery if necessary
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

      if (!args.lnd) {
        return cbk([400, 'ExpectedLndToInitiateSwapOut']);
      }

      if (!args.logger) {
        return cbk([400, 'ExpectedLoggerForSwapProgressNotifications']);
      }

      if (!!args.spend_address && !args.spend_tokens) {
        return cbk([400, 'ExpectedSpendAmountWhenSpecifyingSpendAddress']);
      }

      if (!!args.spend_tokens && !args.spend_address) {
        return cbk([400, 'ExpectedSpendAddressWhenSpecifyingSpendTokens']);
      }

      if (args.spend_tokens > args.tokens) {
        return cbk([400, 'ExpectedSpendTokensLessThanTotalTokens']);
      }

      if (!args.timeout) {
        return cbk([400, 'ExpectedTimeoutToWaitForSwapDeposit']);
      }

      if (!args.recovery && !args.tokens) {
        return cbk([400, 'ExpectedTokensToIncreaseLiquidity']);
      }

      return cbk();
    }],

    // Get channels
    getChannels: ['validate', ({}, cbk) => {
      return getChannels({lnd: args.lnd, is_active: true}, cbk);
    }],

    // Get network
    getNetwork: ['validate', ({}, cbk) => getNetwork({lnd: args.lnd}, cbk)],

    // Get wallet info
    getWalletInfo: ['validate', ({}, cbk) => {
      return getWalletInfo({lnd: args.lnd}, cbk);
    }],

    // Externals sends
    sends: ['validate', ({}, cbk) => {
      if (!args.spend_address) {
        return cbk();
      }

      if (Number(args.spend_tokens) + changeTokens > args.tokens) {
        return cbk([
          400,
          'ExpectedSwapAmountGreaterThanSpendAmount',
          {minimum: Number(args.spend_tokens) + changeTokens},
        ]);
      }

      return cbk(null, [{
        address: args.spend_address,
        tokens: Number(args.spend_tokens),
      }]);
    }],

    // Get the ignore list
    getIgnores: ['getChannels', ({getChannels}, cbk) => {
      return avoidsAsIgnores({
        avoid: args.avoid,
        channels: getChannels.channels,
        lnd: args.lnd,
      },
      cbk);
    }],

    // Create a sweep address
    createAddress: ['recover', 'sends', ({recover}, cbk) => {
      // Exit early when there is already a sweep address specified in recovery
      if (!!recover && recover.sweep_address) {
        return cbk(null, {address: recover.sweep_address});
      }

      // Exit early when the sweep out address is directly specified
      if (!!args.out_address) {
        return cbk(null, {address: args.out_address});
      }

      return createChainAddress({format: 'p2wpkh', lnd: args.lnd}, cbk);
    }],

    // Get the current block height
    startHeight: ['getWalletInfo', ({getWalletInfo}, cbk) => {
      return cbk(null, getWalletInfo.current_block_height);
    }],

    // Figure out which channel to use when swapping with a peer
    channel: ['getChannels', ({getChannels}, cbk) => {
      // Exit early when this is a recovery, or there is no peer selected
      if (!!args.recovery || !args.peer) {
        return cbk();
      }

      const peerChans = getChannels.channels.filter(chan => {
        return chan.partner_public_key === args.peer;
      });

      const [channel] = peerChans.filter(n => n.local_balance > args.tokens);

      // There was no channel found to use for the swap
      if (!channel) {
        return cbk([400, 'InsufficientOutboundLiquidityToConvertToInbound']);
      }

      return getNode({
        is_omitting_channels: true,
        lnd: args.lnd,
        public_key: channel.partner_public_key,
      },
      (err, res) => {
        if (!!err) {
          return cbk(err);
        }

        return cbk(null, {
          alias: res.alias,
          id: channel.id,
          peer_channels: peerChans,
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
      // Exit early when recovering from an in-progress swap
      if (!!recover) {
        return cbk(null, recover.start_height);
      }

      return cbk(null, getWalletInfo.current_block_height);
    }],

    // Network for swap
    network: ['getNetwork', ({getNetwork}, cbk) => {
      return cbk(null, getNetwork.network);
    }],

    // Currency of swap
    currency: ['network', ({network}, cbk) => {
      return cbk(null, currencySymbols[network]);
    }],

    // Recover address
    recoverAddress: ['network', 'recover', ({network, recover}, cbk) => {
      if (!args.recovery) {
        return cbk();
      }

      // Derive recovery address for an in-progress swap
      try {
        const {address} = addressForScript({network, script: recover.script});

        return cbk(null, address);
      } catch (err) {
        return cbk([400, 'FailedToDeriveSwapAddress', {err}]);
      }
    }],

    // Get the quote for swaps
    getQuote: ['getLimits', 'getService', ({getLimits, getService}, cbk) => {
      // Exit early when this is a recovery of an existing swap
      if (!!args.recovery) {
        return cbk();
      }

      if (args.tokens > getLimits.max_tokens) {
        return cbk([400, 'SwapSizeTooLarge', {max: getLimits.max_tokens}]);
      }

      if (args.tokens < getLimits.min_tokens) {
        return cbk([400, 'SwapSizeTooSmall', {min: getLimits.min_tokens}]);
      }

      return getSwapOutQuote({
        macaroon: getService.macaroon,
        preimage: getService.preimage,
        service: getService.service,
        tokens: args.tokens,
      },
      cbk);
    }],

    // Check quote to validate parameters of the swap
    checkQuote: ['getQuote', ({getQuote}, cbk) => {
      if (!!args.recovery) {
        return cbk();
      }

      if (getQuote.deposit > round(args.tokens * maxFeeRate)) {
        return cbk([400, 'DepositExceedsMaxFeeRate']);
      }

      if (getQuote.fee > round(args.tokens * maxFeeRate)) {
        return cbk([400, 'TotalFeeExceedsMaxFeeRate']);
      }

      if (!!args.max_fee && getQuote.fee > args.max_fee) {
        return cbk([400, 'FeeForSwapExceedsMaximumFeeLimit', getQuote]);
      }

      if (getQuote.cltv_delta < minCltvDelta) {
        return cbk([400, 'ExpectedMoreTimeToCompleteSwap']);
      }

      const fundConfs = (args.confs || minConfs);
      const swapDelayMin = !args.is_fast ? slowDelayMinutes : fastDelayMinutes;
      const sweepConfs = (args.confs || minConfs);

      const allFees = getQuote.fee;
      const swapMinimumMinutes = (fundConfs + sweepConfs) * minutesPerBlock;
      const swapTimeoutMinutes = getQuote.cltv_delta * minutesPerBlock;

      const fastestSwapTime = moment().add(swapMinimumMinutes, 'minutes');
      const swapTimeout = moment().add(swapTimeoutMinutes, 'minutes');

      args.logger.info({
        estimated_time: {
          start_at: moment().calendar(),
          earliest_completion: fastestSwapTime.add(swapDelayMin).fromNow(),
          forfeit_funds_deadline_at: swapTimeout.fromNow(),
        },
      });

      return cbk(null, {deposit: getQuote.deposit, service_fee: allFees});
    }],

    // Upgrade service object to a paid service if necessary
    getService: ['network', 'recover', 'recoverAddress', ({network}, cbk) => {
      // Exit early when the swap is already initiated
      if (!!args.recovery) {
        return cbk();
      }

      return getPaidService({
        network,
        lnd: args.lnd,
        logger: args.logger,
        socket: args.socket,
        token: args.api_key,
      },
      cbk);
    }],

    // Get limits
    getLimits: ['getService', ({getService}, cbk) => {
      // Exit early when in recovery
      if (!!args.recovery) {
        return cbk();
      }

      return getSwapOutTerms({
        macaroon: getService.macaroon,
        preimage: getService.preimage,
        service: getService.service,
      },
      cbk);
    }],

    // Make sweep
    initiateSwap: [
      'checkQuote',
      'getService',
      'network',
      'recover',
      'recoverAddress',
      ({getService, network, recover, recoverAddress}, cbk) =>
    {
      // Exit early when the swap is already initiated
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

      if (!!getService.paid && !!getService.token) {
        args.logger.info({
          amount_paid_for_api_key: tokensAsBigUnit(getService.paid),
          service_api_key: getService.token,
          service_user_id: getService.id,
        });
      }

      const swapDelayMin = !args.is_fast ? slowDelayMinutes : fastDelayMinutes;

      const fundAt = moment().add(swapDelayMin, 'minutes');

      return createSwapOut({
        network,
        fund_at: fundAt.toISOString(),
        macaroon: getService.macaroon,
        preimage: getService.preimage,
        service: getService.service,
        tokens: args.tokens,
      },
      cbk);
    }],

    // Decode swap execution request
    decodeExecutionRequest: ['initiateSwap', ({initiateSwap}, cbk) => {
      if (!!args.recovery) {
        return cbk();
      }

      return decodePaymentRequest({
        lnd: args.lnd,
        request: initiateSwap.swap_execute_request,
      },
      cbk);
    }],

    // Check swap
    checkSwap: [
      'createAddress',
      'decodeExecutionRequest',
      'getWalletInfo',
      'initiateSwap',
      'startHeight',
      ({
        createAddress,
        decodeExecutionRequest,
        getWalletInfo,
        initiateSwap,
        startHeight,
      }, cbk) =>
    {
      // Exit early when the swap is already started or is just a test run
      if (!!args.is_dry_run || !!args.recovery) {
        return cbk();
      }

      // Output a recovery blob that can be used to restart the swap
      try {
        const {recovery} = encodeSwapRecovery({
          claim_private_key: initiateSwap.private_key,
          execution_id: decodeExecutionRequest.id,
          refund_public_key: initiateSwap.service_public_key,
          secret: initiateSwap.secret,
          start_height: startHeight,
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
    decodeFundingRequest: ['initiateSwap', ({initiateSwap}, cbk) => {
      if (!!args.recovery) {
        return cbk();
      }

      return decodePaymentRequest({
        lnd: args.lnd,
        request: initiateSwap.swap_fund_request,
      },
      cbk);
    }],

    // Check that the payment requests match the validated quote
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

      if (decodeFundingRequest.tokens > getQuote.fee + args.tokens) {
        return cbk([503, 'UnexpectedServiceCostForSwap']);
      }

      return cbk();
    }],

    // Probe for execution
    findRouteForExecution: [
      'channel',
      'decodeExecutionRequest',
      'getIgnores',
      'getStartHeight',
      ({channel, decodeExecutionRequest, getIgnores, getStartHeight}, cbk) =>
    {
      // Exit early when there is a swap recovery
      if (!!args.recovery) {
        return cbk();
      }

      const hasFeatures = !!decodeExecutionRequest.features.length;

      return executeProbe({
        cltv_delta: decodeExecutionRequest.cltv_delta + cltvBuffer,
        destination: decodeExecutionRequest.destination,
        features: !!hasFeatures ? decodeExecutionRequest.features : undefined,
        ignore: getIgnores.ignore,
        lnd: args.lnd,
        logger: args.logger,
        max_fee: maxExecutionFeeTokens,
        outgoing_channel: !!channel ? channel.id : undefined,
        routes: decodeExecutionRequest.routes,
        tokens: decodeExecutionRequest.tokens,
      },
      (err, res) => {
        if (!!err) {
          return cbk([503, 'UnexpectedErrorFindingRouteForExecution', {err}]);
        }

        if (!res.route) {
          return cbk([503, 'FailedToFindAPathToPaySwapExecutionFee']);
        }

        return cbk(null, res.route);
      });
    }],

    // Probe for funding routes
    findRoutesForFunding: [
      'channel',
      'currency',
      'decodeFundingRequest',
      'getIgnores',
      'getStartHeight',
      'initiateSwap',
      ({
        channel,
        currency,
        decodeFundingRequest,
        getIgnores,
        getStartHeight,
        initiateSwap,
      }, cbk) =>
    {
      if (!!args.recovery) {
        return cbk();
      }

      const hasFeatures = !!decodeFundingRequest.features.length;

      return getRoutesForFunding({
        cltv_delta: decodeFundingRequest.cltv_delta + cltvBuffer,
        destination: decodeFundingRequest.destination,
        features: !!hasFeatures ? decodeFundingRequest.features : undefined,
        ignore: getIgnores.ignore,
        lnd: args.lnd,
        logger: args.logger,
        max_fee: round(decodeFundingRequest.tokens / maxRoutingFeeDenominator),
        max_paths: args.max_paths || undefined,
        out_through: !!args.peer ? channel.public_key : undefined,
        outgoing_channel: !!channel ? channel.id : undefined,
        payment: decodeFundingRequest.payment,
        request: initiateSwap.swap_fund_request,
        routes: decodeFundingRequest.routes,
        tokens: decodeFundingRequest.tokens,
      },
      cbk);
    }],

    // Get info about the peer we are going to get inbound liquidity with
    getSwapPeers: [
      'channel',
      'findRoutesForFunding',
      'getChannels',
      ({channel, findRoutesForFunding, getChannels}, cbk) =>
    {
      // Exit early when this is a recovery
      if (!!args.recovery) {
        return cbk();
      }

      // Exit early when a peer is specified
      if (!!args.peer) {
        return cbk(null, [{
          alias: channel.alias,
          peer_channels: getChannels.channels.filter(channel => {
            return channel.partner_public_key === args.peer;
          }),
          public_key: channel.public_key,
        }]);
      }

      return asyncMap(findRoutesForFunding.routes, (route, cbk) => {
        const [firstHop] = route.hops;

        return getNode({
          is_omitting_channels: true,
          lnd: args.lnd,
          public_key: firstHop.public_key,
        },
        (err, res) => {
          return cbk(null, {
            alias: !!res ? res.alias : undefined,
            peer_channels: getChannels.channels.filter(channel => {
              return channel.partner_public_key === firstHop.public_key;
            }),
            public_key: firstHop.public_key,
          });
        });
      },
      cbk);
    }],

    // Get fee estimate for sweep
    getMinSweepFee: [
      'currency',
      'decodeExecutionRequest',
      'decodeFundingRequest',
      'findRouteForExecution',
      'findRoutesForFunding',
      'getSwapPeers',
      'getQuote',
      ({
        currency,
        decodeExecutionRequest,
        decodeFundingRequest,
        findRouteForExecution,
        findRoutesForFunding,
        getSwapPeers,
        getQuote,
      }, cbk) =>
    {
      // Exit early when this is a recovery
      if (!!args.recovery) {
        return cbk();
      }

      const executionRoutingFee = findRouteForExecution.fee || Number();
      const executionSend = decodeExecutionRequest.tokens;
      const fundingRoutingFee = findRoutesForFunding.fee || Number();
      const fundingSend = decodeFundingRequest.tokens;
      const increase = `${tokensAsBigUnit(args.tokens)} ${currency}`;
      const peerChannels = flatten(getSwapPeers.map(n => n.peer_channels));
      const sumOf = tokens => tokens.reduce((sum, n) => sum + n, Number());

      const peerIn = peerChannels.map(n => n.remote_balance);
      const peerOut = peerChannels.map(n => n.local_balance);
      const routingFees = executionRoutingFee + fundingRoutingFee;
      const serviceFee = fundingSend + executionSend - args.tokens;

      return getChainFeeRate({
        confirmation_target: getQuote.cltv_delta,
        lnd: args.lnd,
      },
      (err, res) => {
        if (!!err) {
          return cbk(err);
        }

        const sweepFee = res.tokens_per_vbyte * estimatedSweepVbytes;

        const allFees = ceil(serviceFee + sweepFee + routingFees);

        if (!!args.max_fee && allFees > args.max_fee) {
          return cbk([400, 'MaxFeeTooLowToExecuteSwap', {needed: allFees}]);
        }

        args.logger.info({
          inbound_liquidity_increase: increase,
          with_peers: getSwapPeers.map(n => `${n.alias} ${n.public_key}`),
          swap_service_fee: `${tokensAsBigUnit(serviceFee)} ${currency}`,
          estimated_total_fee: `${tokensAsBigUnit(allFees)} ${currency}`,
          peers_inbound: `${tokensAsBigUnit(sumOf(peerIn))} ${currency}`,
          peers_outbound: `${tokensAsBigUnit(sumOf(peerOut))} ${currency}`,
        });

        if (!!args.is_dry_run) {
          return cbk([500, 'InboundLiquidityIncreaseDryRun']);
        }

        return cbk(null, res.tokens_per_vbyte);
      });
    }],

    // Pay to swap funding
    payToFund: [
      'checkRequestAmounts',
      'checkSwap',
      'decodeFundingRequest',
      'findRouteForExecution',
      'findRoutesForFunding',
      ({decodeFundingRequest, findRoutesForFunding}, cbk) =>
    {
      if (!!args.recovery) {
        return cbk();
      }

      args.logger.info({funding_swap: decodeFundingRequest.id});

      return asyncMap(findRoutesForFunding.routes, (route, cbk) => {
        return payViaRoutes({
          id: decodeFundingRequest.id,
          lnd: args.lnd,
          routes: [route],
        },
        cbk);
      },
      (err, res) => {
        if (!!err) {
          return cbk([503, 'UnexpectedErrorFundingSwap', {err}]);
        }

        return cbk(null, res);
      });
    }],

    // Pay to swap execution
    payToExecute: [
      'channel',
      'checkRequestAmounts',
      'checkSwap',
      'decodeExecutionRequest',
      'findRouteForExecution',
      'findRoutesForFunding',
      'getMinSweepFee',
      'getQuote',
      'getStartHeight',
      'initiateSwap',
      ({
        channel,
        decodeExecutionRequest,
        getQuote,
        getStartHeight,
        initiateSwap,
      }, cbk) =>
    {
      if (!!args.recovery) {
        return cbk();
      }

      const swapDelayMin = !args.is_fast ? slowDelayMinutes : fastDelayMinutes;

      const fundAt = moment().add(swapDelayMin, 'minutes');

      args.logger.info({
        paying_execution_request: decodeExecutionRequest.id,
        estimated_swap_start_time: fundAt.calendar(),
      });

      const sub = subscribeToPayViaRequest({
        lnd: args.lnd,
        max_fee: maxExecutionFeeTokens,
        max_timeout_height: getStartHeight + maxCltvExpiration,
        outgoing_channel: !!channel ? channel.id : undefined,
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
        if (!!failed.is_pathfinding_timeout) {
          return finished([503, 'TimedOutFindingALightningRoute']);
        }

        return finished([503, 'UnexpectedOutcomeOfSwapFailure', {failed}]);
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
      'getWalletInfo',
      'initiateSwap',
      'network',
      'recover',
      ({getWalletInfo, initiateSwap, network, recover}, cbk) =>
    {
      const currentHeight = getWalletInfo.current_block_height;
      const sub = subscribeToBlocks({lnd: args.lnd});
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
        lnd: args.lnd,
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

    // Register deposit height
    depositHeight: ['findDeposit', ({findDeposit}, cbk) => {
      if (!!args.recovery) {
        return cbk();
      }

      return getWalletInfo({lnd: args.lnd}, (err, res) => {
        if (!!err) {
          return cbk(err);
        }

        return cbk(null, res.current_block_height);
      });
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
      'depositHeight',
      'initiateSwap',
      'network',
      'recover',
      'sends',
      'startHeight',
      ({
        claim,
        createAddress,
        depositHeight,
        initiateSwap,
        network,
        recover,
        sends,
        startHeight,
      }, cbk) =>
    {
      // Exit early when the raw recovery option is not toggled
      if (!args.is_raw_recovery_shown) {
        return cbk();
      }

      return getRawRecoveries({
        network,
        sends,
        confs: args.confs,
        deposit_height: depositHeight,
        lnd: args.lnd,
        max_wait_blocks: args.max_wait_blocks,
        private_key: claim.private_key,
        script: claim.script,
        secret: claim.secret,
        start_height: startHeight,
        sweep_address: createAddress.address,
        timeout: initiateSwap.timeout,
        tokens: !recover ? args.tokens : recover.tokens,
        transaction_id: claim.transaction_id,
        transaction_vout: claim.transaction_vout,
      },
      (err, res) => {
        if (!!err) {
          return cbk(err);
        }

        res.recoveries.forEach(recovery => args.logger.info(recovery));

        return cbk();
      });
    }],

    // Execute the sweep
    sweep: [
      'claim',
      'createAddress',
      'depositHeight',
      'getMinSweepFee',
      'getService',
      'initiateSwap',
      'network',
      'rawRecovery',
      'recover',
      'sends',
      'startHeight',
      ({
        claim,
        createAddress,
        depositHeight,
        getMinSweepFee,
        getService,
        initiateSwap,
        network,
        recover,
        sends,
        startHeight,
      }, cbk) =>
    {
      const blocksUntilTimeout = initiateSwap.timeout - startHeight;

      if (blocksUntilTimeout < args.confs) {
        return cbk([503, 'FailedToReceiveSwapFundingConfirmationInTime']);
      }

      args.logger.info({swap_deposit_confirmed: claim.transaction_id});

      const blocksSubscription = subscribeToBlocks({lnd: args.lnd});
      const tokens = !recover ? args.tokens : recover.tokens;

      blocksSubscription.on('end', () => {});
      blocksSubscription.on('error', () => {});
      blocksSubscription.on('status', () => {});

      const startingHeight = depositHeight || initiateSwap.start_height;

      // On every block, attempt a sweep
      blocksSubscription.on('block', ({height}) => {
        return attemptSweep({
          network,
          request,
          sends,
          tokens,
          current_height: height,
          deadline_height: initiateSwap.timeout - args.confs,
          lnd: args.lnd,
          max_fee_multiplier: maxFeeMultiplier,
          min_fee_rate: getMinSweepFee,
          private_key: claim.private_key,
          secret: claim.secret,
          start_height: startingHeight - fuzzBlocks,
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

            args.logger.info({
              attempting_sweep_fee_rate: res.fee_rate,
              attempt_tx_id: Transaction.fromHex(res.transaction).getId(),
            });

            return releaseSwapOutSecret({
              auth_macaroon: getService.macaroon,
              auth_preimage: getService.preimage,
              secret: claim.secret,
              service: getService.service,
            },
            err => {
              // Suppress errors releasing secret
              return;
            });
          },
          sweepProgressLogDelayMs);
        });
      });

      return findDeposit({
        network,
        address: createAddress.address,
        after: startHeight,
        confirmations: max(args.confs, minSweepConfs),
        lnd: args.lnd,
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
      'payToFund',
      'recover',
      'sweep',
      ({decodeFundingRequest, recover}, cbk) =>
    {
      const fundingRequest = decodeFundingRequest || {};

      const id = fundingRequest.id || sha256(recover.secret).digest('hex');

      const sub = subscribeToPastPayment({id, lnd: args.lnd});

      const finished = (err, res) => {
        sub.removeAllListeners();

        return cbk(err, res);
      };

      sub.once('confirmed', payment => {
        if (!!fundingRequest.id) {
          args.logger.info({
            inbound_liquidity_increased: tokensAsBigUnit(payment.safe_tokens),
          });
        }

        return finished(null, {payment});
      });

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
      'payToExecute',
      'recover',
      ({decodeExecutionRequest, recover}, cbk) =>
    {
      const executionRequest = decodeExecutionRequest || {};

      const id = executionRequest.id || recover.execution_id;

      return getPayment({id, lnd: args.lnd}, cbk);
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
      'getFundingPayment',
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
      const routingFeeTokens = Number(offchainFee);
      const swapFeeMtokens = BigInt(spentOffchain.spent) - amountReceived;

      const increase = tokensAsBigUnit(Number(liquidityIncrease));
      const swapFee = Number(swapFeeMtokens / mtokPerTok);

      const serviceFee = swapFee - routingFeeTokens - chainFee;

      args.logger.info({
        completed: moment().calendar(),
        inbound_increased: `${increase} ${currency}`,
        chain_fee_paid: `${tokensAsBigUnit(chainFee)} ${currency}`,
        routing_fee_paid: `${tokensAsBigUnit(routingFeeTokens)} ${currency}`,
        service_fee_paid: `${tokensAsBigUnit(serviceFee)} ${currency}`,
        total_fee_paid: `${tokensAsBigUnit(swapFee)} ${currency}`,
      });

      return cbk(null, {is_complete: true});
    }],
  },
  returnResult({}, cbk));
};
