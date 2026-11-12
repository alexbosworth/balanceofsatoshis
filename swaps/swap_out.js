const EventEmitter = require('events');

const asyncAuto = require('async/auto');
const asyncify = require('async/asyncify');
const asyncMap = require('async/map');
const {cancelSwapOut} = require('goldengate');
const {completeOffToOnSwap} = require('paid-services');
const {decodeLoopResponse} = require('paid-services');
const {decodeOffToOnRestart} = require('paid-services');
const {decodePaymentRequest} = require('ln-service');
const {encodeOffToOnRestart} = require('paid-services');
const {formatTokens} = require('ln-sync');
const {getChainFeeRate} = require('ln-service');
const {getChannels} = require('ln-service');
const {getHeight} = require('ln-service');
const {getIdentity} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {getNode} = require('ln-service');
const {getNodeAlias} = require('ln-sync');
const {getPayment} = require('ln-service');
const {getSwapOutQuote} = require('goldengate');
const {getSwapOutTerms} = require('goldengate');
const {getSyntheticOutIgnores} = require('probing');
const moment = require('moment');
const {payViaRoutes} = require('ln-service');
const {requestLoopOut} = require('paid-services');
const {returnResult} = require('asyncjs-util');
const {startOffToOnSwap} = require('paid-services');
const {subscribeToMultiPathPay} = require('probing');
const {subscribeToMultiPathProbe} = require('probing');
const {subscribeToPayViaRequest} = require('ln-service');

const channelForSend = require('./channel_for_send');
const {cltvDeltaBuffer} = require('./constants');
const {currencySymbols} = require('./../network/networks');
const {describeRoute} = require('./../display');
const {describeRoutingFailure} = require('./../display');
const {estimatedSweepVbytes} = require('./constants');
const {executeProbe} = require('./../network');
const {externalPayUpdates} = require('./constants');
const {fastDelayMinutes} = require('./constants');
const findRebalancePeer = require('./find_rebalance_peer');
const {getIcons} = require('./../display');
const {getIgnores} = require('./../routing');
const getPaidService = require('./get_paid_service');
const getRoutesForFunding = require('./get_routes_for_funding');
const {getTags} = require('./../tags');
const {invoiceNetworks} = require('./constants');
const {maxDepositTokens} = require('./constants');
const {maxExecutionFeeTokens} = require('./constants');
const {maxFeeRate} = require('./constants');
const {maxPathfindingMs} = require('./constants');
const {maxRoutingFeeDenominator} = require('./constants');
const {minConfs} = require('./constants');
const {minutesPerBlock} = require('./constants');
const {slowDelayMinutes} = require('./constants');

const addressMatch = /\b((bc|tb)(0([ac-hj-np-z02-9]{39}|[ac-hj-np-z02-9]{59})|1[ac-hj-np-z02-9]{8,87})|([13]|[mn2])[a-km-zA-HJ-NP-Z1-9]{25,39})\b/i;
const {ceil} = Math;
const cltvBuffer = 3;
const defaultMaxPaths = 1;
const flatten = arr => [].concat(...arr);
const httpMatch = /^https?:\/\//;
const {isArray} = Array;
const isLimit = n => Number.isSafeInteger(n) && n > 0;
const isPayUpdate = update => !!externalPayUpdates.find(n => !!update[n]);
const {round} = Math;
const sumOf = tokens => tokens.reduce((sum, n) => sum + n, Number());
const swapDelayMinutes = fast => !!fast ? fastDelayMinutes : slowDelayMinutes;
const tokensAsBigUnit = tokens => ((tokens || 0) / 1e8).toFixed(8);
const uniq = arr => Array.from(new Set(arr));

/** Get additional inbound liquidity

  {
    [api_key]: <API Key CBOR String>
    avoid: [<Avoid Forwarding Through Node With Public Key Hex String>]
    confs: <Confirmations to Wait for Deposit Number>
    fetch: <Fetch Function>
    fs: {
      getFile: <Read File Contents Function> (path, cbk) => {}
    }
    [is_dry_run]: <Avoid Actually Executing Operation Bool>
    [is_fast]: <Execute Swap Immediately Bool>
    lnd: <Authenticated LND gRPC API Object>
    logger: <Winston Logger Object>
    [max_api_key_fee]: <Maximum Tokens to Pay for a Service API Key Number>
    [max_deposit]: <Maximum Swap Deposit Tokens Number>
    max_fee: <Maximum Fee Tokens Number>
    [max_paths]: <Maximum Paths For Funding Number> (default: 1)
    [out_address]: <Out Address String>
    [out_filters]: [<Out Peer Filter Formula String>]
    [peer]: <Peer Public Key, Alias or Tag String>
    [recovery]: <Recover In-Progress Swap Hex String>
    [socket]: <Custom Backing Service Host:Port String>
    tokens: <Tokens Number>
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isArray(args.avoid)) {
          return cbk([400, 'ExpectedAvoidArrayToInitiateSwapOut']);
        }

        if (args.confs === undefined) {
          return cbk([400, 'ExpectedConfirmationsCountToConsiderReorgSafe']);
        }

        if (!args.fetch) {
          return cbk([400, 'ExpectedFetchFunctionToInitiateSwapOut']);
        }

        if (!args.fs) {
          return cbk([400, 'ExpectedFileSystemFunctionsToInitiateSwapOut']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToInitiateSwapOut']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerForSwapProgressNotifications']);
        }

        if (args.max_deposit !== undefined && !isLimit(args.max_deposit)) {
          return cbk([400, 'ExpectedMaxDepositAboveZeroToInitiateSwapOut']);
        }

        if (args.max_fee === undefined) {
          return cbk([400, 'ExpectedMaxFeeToIncreaseInboundLiquidity']);
        }

        if (!isLimit(args.max_fee)) {
          return cbk([400, 'ExpectedMaxFeeAboveZeroToInitiateSwapOut']);
        }

        if (!!args.out_address && !addressMatch.test(args.out_address)) {
          return cbk([400, 'UnrecognizedFormatOfOutAddress']);
        }

        if (!!args.out_filters && !isArray(args.out_filters)) {
          return cbk([400, 'ExpectedArrayOfOutFiltersToInitiateSwapOut']);
        }

        // Filters select a peer from a tag or check the specified peer
        if (!!args.out_filters && !!args.out_filters.length && !args.peer) {
          return cbk([400, 'ExpectedPeerOrTagToApplyOutFiltersTo']);
        }

        // A web service socket is for services without Taproot swaps
        if (!!args.socket && httpMatch.test(args.socket)) {
          return cbk([400, 'ExpectedHostAndPortSocketToInitiateSwapOut']);
        }

        if (!args.recovery && !args.tokens) {
          return cbk([400, 'ExpectedTokensToIncreaseLiquidity']);
        }

        return cbk();
      },

      // Deadline for the swap service to publish the swap funding on chain
      deadline: ['validate', ({}, cbk) => {
        const fundAt = moment().add(swapDelayMinutes(args.is_fast), 'minutes');

        return cbk(null, fundAt.toISOString());
      }],

      // Find the peer to spend down a channel with to increase inbound
      findPeer: [
        'getChannels',
        'getPolicies',
        'getTags',
        ({getChannels, getPolicies, getTags}, cbk) =>
      {
        // Exit early when there is no peer to select
        if (!args.peer) {
          return cbk(null, {});
        }

        return findRebalancePeer({
          active_channels: getChannels.channels,
          channels: getChannels.channels,
          direction: 'out',
          filters: args.out_filters,
          lnd: args.lnd,
          policies: getPolicies.policies,
          query: args.peer,
          tags: getTags.tags,
        },
        cbk);
      }],

      // Get current channel liquidity details
      getChannels: ['validate', ({}, cbk) => {
        return getChannels({lnd: args.lnd, is_active: true}, cbk);
      }],

      // Get the current block height
      getHeight: ['validate', ({}, cbk) => {
        // Exit early when recovering an in-progress swap
        if (!!args.recovery) {
          return cbk();
        }

        return getHeight({lnd: args.lnd}, cbk);
      }],

      // Get node icons
      getIcons: ['validate', ({}, cbk) => getIcons({fs: args.fs}, cbk)],

      // Get the node public key
      getIdentity: ['validate', ({}, cbk) => {
        // Exit early when there are no avoids and no peer to select
        if (!args.avoid.length && !args.peer) {
          return cbk();
        }

        return getIdentity({lnd: args.lnd}, cbk);
      }],

      // Get the network this swap is taking place on
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd: args.lnd}, cbk)],

      // Get the policies of peers to apply filters to peer selection
      getPolicies: ['getIdentity', ({getIdentity}, cbk) => {
        // Exit early when there is no peer to select
        if (!args.peer) {
          return cbk();
        }

        const id = getIdentity.public_key;

        return getNode({lnd: args.lnd, public_key: id}, (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          const policies = res.channels.map(channel => {
            const policy = channel.policies.find(n => n.public_key !== id);

            return {
              base_fee_mtokens: policy.base_fee_mtokens,
              fee_rate: policy.fee_rate,
              public_key: policy.public_key,
            };
          });

          return cbk(null, {policies});
        });
      }],

      // Get tags for figuring out avoid flags and the peer to select
      getTags: ['validate', ({}, cbk) => {
        // Exit early when there are no avoids and no peer to select
        if (!args.avoid.length && !args.peer) {
          return cbk();
        }

        return getTags({fs: args.fs}, cbk);
      }],

      // Decode the restart details of an in-progress swap
      recover: ['validate', asyncify(() => {
        // Exit early when there is no in-progress swap to recover
        if (!args.recovery) {
          return;
        }

        try {
          return decodeOffToOnRestart({restart: args.recovery});
        } catch (err) {
          throw [400, 'FailedToDecodeSwapRecoveryDetails', {err}];
        }
      })],

      // Get peer details
      getPeerDetails: ['findPeer', ({findPeer}, cbk) => {
        // Exit early when there is no peer to get details of
        if (!findPeer.public_key) {
          return cbk();
        }

        return getNodeAlias({id: findPeer.public_key, lnd: args.lnd}, cbk);
      }],

      // Figure out which channel to use when swapping with a peer
      channel: ['findPeer', 'getChannels', ({findPeer, getChannels}, cbk) => {
        // Exit early when this is a recovery, or there is no peer selected
        if (!!args.recovery || !findPeer.public_key) {
          return cbk();
        }

        const {id} = channelForSend({
          tokens: args.tokens,
          channels: getChannels.channels,
          peer: findPeer.public_key,
        });

        // There was no channel found to use for the swap
        if (!id) {
          return cbk([400, 'InsufficientOutboundLiquidityToConvertToInbound']);
        }

        return cbk(null, {id});
      }],

      // Get base ignores
      getBaseIgnores: [
        'getChannels',
        'getIdentity',
        'getTags',
        ({getChannels, getIdentity, getTags}, cbk) =>
      {
        // Exit early when there are no avoids
        if (!args.avoid.length) {
          return cbk(null, {ignore: []});
        }

        return getIgnores({
          avoid: args.avoid,
          channels: getChannels.channels,
          lnd: args.lnd,
          logger: args.logger,
          public_key: getIdentity.public_key,
          tags: getTags.tags,
        },
        cbk);
      }],

      // Get the ignore list from avoid directives
      getIgnores: [
        'findPeer',
        'getBaseIgnores',
        ({findPeer, getBaseIgnores}, cbk) =>
      {
        // Exit early when there is no specific peer
        if (!findPeer.public_key) {
          return cbk(null, {ignore: getBaseIgnores.ignore});
        }

        return getSyntheticOutIgnores({
          ignore: getBaseIgnores.ignore,
          lnd: args.lnd,
          out: [findPeer.public_key],
        },
        cbk);
      }],

      // Currency of swap
      currency: ['getNetwork', ({getNetwork}, cbk) => {
        return cbk(null, currencySymbols[getNetwork.network]);
      }],

      // Get a paid service object, or convert prepaid token to service object
      getService: ['validate', ({}, cbk) => {
        // Exit early when the swap is already initiated
        if (!!args.recovery) {
          return cbk();
        }

        return getPaidService({
          fetch: args.fetch,
          lnd: args.lnd,
          max_fee: args.max_api_key_fee,
          socket: args.socket,
          token: args.api_key,
        },
        cbk);
      }],

      // Check that a payment of a recovered swap was made, so it started
      checkPayments: [
        'getNetwork',
        'recover',
        ({getNetwork, recover}, cbk) =>
      {
        // Exit early when there is no swap service swap to recover
        if (!args.recovery || !recover.is_loop_service) {
          return cbk();
        }

        const network = invoiceNetworks[getNetwork.network];
        const {response} = recover;

        try {
          decodeLoopResponse({network, response});
        } catch (err) {
          return cbk([400, 'FailedToDecodeSwapRecoveryResponse', {err}]);
        }

        const details = decodeLoopResponse({network, response});

        return asyncMap([details.deposit_id, details.fund_id], (id, cbk) => {
          return getPayment({id, lnd: args.lnd}, (err, res) => {
            // Exit early when the payment was never made
            if (isArray(err) && err.slice().shift() === 404) {
              return cbk(null, {is_started: false});
            }

            if (!!err) {
              return cbk(err);
            }

            // A payment that is paid or in flight started the swap
            return cbk(null, {is_started: !res.is_failed});
          });
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          // Exit early when a payment started the swap, the swap continues
          if (res.some(n => n.is_started)) {
            return cbk();
          }

          return cbk([404, 'SwapNeverStartedSwapPaymentsNotMade']);
        });
      }],

      // Get swap out limits
      getLimits: ['getService', ({getService}, cbk) => {
        // Exit early when in recovery
        if (!!args.recovery) {
          return cbk();
        }

        return getSwapOutTerms({
          metadata: getService.metadata,
          service: getService.service,
        },
        cbk);
      }],

      // Get the quote for swaps
      getQuote: [
        'deadline',
        'getHeight',
        'getLimits',
        'getService',
        ({deadline, getHeight, getLimits, getService}, cbk) =>
      {
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
          delay: deadline,
          metadata: getService.metadata,
          service: getService.service,
          timeout: getHeight.current_block_height + getLimits.max_cltv_delta,
          tokens: args.tokens,
        },
        cbk);
      }],

      // Check quote to validate parameters of the swap
      checkQuote: ['getQuote', ({getQuote}, cbk) => {
        // Exit early when this is a recovery of an existing swap
        if (!!args.recovery) {
          return cbk();
        }

        if (getQuote.deposit > (args.max_deposit || maxDepositTokens)) {
          return cbk([400, 'SwapDepositExceedsMaxDepositLimit']);
        }

        if (getQuote.fee > round(args.tokens * maxFeeRate)) {
          return cbk([400, 'TotalFeeExceedsMaxFeeRate']);
        }

        if (getQuote.fee > args.max_fee) {
          return cbk([400, 'FeeForSwapExceedsMaximumFeeLimit', getQuote]);
        }

        return cbk();
      }],

      // Start the swap request
      startSwap: ['checkQuote', ({}, cbk) => {
        // Exit early when the swap is already initiated
        if (!!args.recovery) {
          return cbk();
        }

        return startOffToOnSwap({lnd: args.lnd, tokens: args.tokens}, cbk);
      }],

      // Request a new swap out from the swap service
      requestSwap: [
        'deadline',
        'getService',
        'startSwap',
        ({deadline, getService, startSwap}, cbk) =>
      {
        // Exit early when the swap is already initiated
        if (!!args.recovery) {
          return cbk();
        }

        if (!!getService.paid && !!getService.token) {
          args.logger.info({
            amount_paid_for_api_key: tokensAsBigUnit(getService.paid),
            service_api_key: getService.token,
            service_user_id: getService.id,
          });
        }

        return requestLoopOut({
          before: deadline,
          lnd: args.lnd,
          macaroon: getService.macaroon,
          preimage: getService.preimage,
          recovery: startSwap.recovery,
          socket: args.socket,
        },
        cbk);
      }],

      // Decode swap execution request
      decodeExecutionRequest: ['requestSwap', ({requestSwap}, cbk) => {
        // Exit early when the swap is already initiated
        if (!!args.recovery) {
          return cbk();
        }

        return decodePaymentRequest({
          lnd: args.lnd,
          request: requestSwap.deposit_request,
        },
        cbk);
      }],

      // Decode funding request
      decodeFundingRequest: ['requestSwap', ({requestSwap}, cbk) => {
        // Exit early when the swap is already initiated
        if (!!args.recovery) {
          return cbk();
        }

        return decodePaymentRequest({
          lnd: args.lnd,
          request: requestSwap.fund_request,
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
        // Exit early when the swap is already initiated
        if (!!args.recovery) {
          return cbk();
        }

        // Check that the no-strings-attached prepay is as quoted
        if (decodeExecutionRequest.tokens !== getQuote.deposit) {
          return cbk([503, 'UnexpectedUnilateralDepositTokensAmount']);
        }

        const deposit = decodeExecutionRequest.tokens;
        const funding = decodeFundingRequest.tokens;

        // The deposit and the funding together pay the swap amount and the fee
        if (deposit + funding > getQuote.fee + args.tokens) {
          return cbk([503, 'UnexpectedServiceCostForSwap']);
        }

        return cbk();
      }],

      // Output a recovery blob that can be used to restart the swap
      restart: [
        'checkRequestAmounts',
        'getHeight',
        'requestSwap',
        'startSwap',
        ({getHeight, requestSwap, startSwap}, cbk) =>
      {
        // Exit early when the swap is already initiated or just a dry run
        if (!!args.recovery || !!args.is_dry_run) {
          return cbk();
        }

        const {restart} = encodeOffToOnRestart({
          is_external_funding: true,
          is_loop_service: true,
          max_deposit_fee: maxExecutionFeeTokens,
          min_confirmations: args.confs,
          recovery: startSwap.recovery,
          request: startSwap.request,
          response: requestSwap.response,
          sweep_address: args.out_address,
        });

        const fundConfs = (args.confs || minConfs);
        const height = getHeight.current_block_height;
        const swapDelayMin = swapDelayMinutes(args.is_fast);
        const sweepConfs = (args.confs || minConfs);

        const confsMinutes = (fundConfs + sweepConfs) * minutesPerBlock;
        const timeoutBlocks = requestSwap.timeout - height;

        const swapMinimumMinutes = confsMinutes + swapDelayMin;
        const swapTimeoutMinutes = timeoutBlocks * minutesPerBlock;

        const fastestSwapTime = moment().add(swapMinimumMinutes, 'minutes');
        const swapTimeout = moment().add(swapTimeoutMinutes, 'minutes');

        args.logger.info({
          restart_recovery_secret: restart,
          estimated_time: {
            start_at: moment().calendar(),
            earliest_completion: fastestSwapTime.fromNow(),
            forfeit_funds_deadline_at: swapTimeout.fromNow(),
          },
        });

        return cbk();
      }],

      // Probe for execution
      findRouteForExecution: [
        'channel',
        'decodeExecutionRequest',
        'decodeFundingRequest',
        'getIcons',
        'getIgnores',
        'getService',
        'restart',
        ({
          channel,
          decodeExecutionRequest,
          decodeFundingRequest,
          getIcons,
          getIgnores,
          getService,
        },
        cbk) =>
      {
        // Exit early when there is a swap recovery
        if (!!args.recovery) {
          return cbk();
        }

        const isFeatured = !!decodeExecutionRequest.features.length;

        return executeProbe({
          cltv_delta: decodeExecutionRequest.cltv_delta + cltvBuffer,
          destination: decodeExecutionRequest.destination,
          features: !!isFeatured ? decodeExecutionRequest.features : undefined,
          ignore: getIgnores.ignore,
          lnd: args.lnd,
          logger: args.logger,
          max_fee: maxExecutionFeeTokens,
          mtokens: decodeExecutionRequest.mtokens,
          outgoing_channels: !!channel ? [channel.id] : undefined,
          payment: decodeExecutionRequest.payment,
          routes: decodeExecutionRequest.routes,
          tagged: !!getIcons ? getIcons.nodes : undefined,
          tokens: decodeExecutionRequest.tokens,
        },
        (err, res) => {
          if (!!err || !res.route) {
            return cancelSwapOut({
              id: decodeFundingRequest.id,
              metadata: getService.metadata,
              payment: decodeFundingRequest.payment,
              service: getService.service,
            },
            () => {
              if (!!err) {
                return cbk([503, 'UnexpectedErrorFindingExecuteRoute', {err}]);
              }

              if (!res.route) {
                return cbk([503, 'FailedToFindAPathToPaySwapExecutionFee']);
              }
            });
          }

          return cbk(null, res.route);
        });
      }],

      // Get peers of the destination node
      getGateways: [
        'decodeFundingRequest',
        'restart',
        ({decodeFundingRequest}, cbk) =>
      {
        if (!!args.recovery) {
          return cbk();
        }

        const finalKey = decodeFundingRequest.destination;

        return getNode({lnd: args.lnd, public_key: finalKey}, (err, res) => {
          if (!!err) {
            return cbk(null, {});
          }

          const policies = res.channels.map(channel => {
            return channel.policies.find(n => n.public_key !== finalKey);
          });

          const keys = uniq(policies.map(n => n.public_key));

          const gateways = keys.filter(n => !!n).map(gateway => ({
            from_public_key: gateway,
            to_public_key: finalKey,
          }));

          return cbk(null, {gateways});
        });
      }],

      // Get funding routes for a multiple path payment
      getFundingRoutes: [
        'decodeFundingRequest',
        'getGateways',
        'getIgnores',
        'getService',
        ({decodeFundingRequest, getGateways, getIgnores, getService}, cbk) =>
      {
        if (!!args.recovery) {
          return cbk();
        }

        // Exit early when not doing multipath funding
        if ((args.max_paths || defaultMaxPaths) < 2) {
          return cbk();
        }

        const hasFeatures = !!decodeFundingRequest.features.length;
        const paths = [];

        const sub = subscribeToMultiPathProbe({
          allow_stacking: getGateways.gateways,
          cltv_delta: decodeFundingRequest.cltv_delta + cltvBuffer,
          destination: decodeFundingRequest.destination,
          features: !!hasFeatures ? decodeFundingRequest.features : undefined,
          ignore: getIgnores.ignore,
          lnd: args.lnd,
          logger: args.logger,
          max_paths: args.max_paths || defaultMaxPaths,
          routes: decodeFundingRequest.routes,
        });

        sub.on('error', err => {
          return cbk([503, 'UnexpectedErrorProbingRouteToSwapService', {err}]);
        });

        sub.on('evaluating', ({tokens}) => {
          return args.logger.info({evaluating: tokens});
        });

        sub.on('failure', () => {
          return cbk([503, 'FailedToFindAnyPathsToSwapServiceDestination']);
        });

        sub.on('path', path => {
          paths.push(path);

          const liquidity = paths.reduce((m, n) => m + n.liquidity, Number());

          return args.logger.info({
            found_liquidity: formatTokens({tokens: liquidity}).display,
            found_paths: paths.length,
          });
        });

        sub.on('probing', async ({route}) => {
          const {description} = await describeRoute({route, lnd: args.lnd});

          return args.logger.info({probing: description});
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

        sub.on('success', ({paths}) => {
          const liquidity = paths.reduce((m, n) => m + n.liquidity, Number());

          if (decodeFundingRequest.tokens > liquidity) {
            return cancelSwapOut({
              id: decodeFundingRequest.id,
              metadata: getService.metadata,
              payment: decodeFundingRequest.payment,
              service: getService.service,
            },
            () => {
              return cbk([
                503,
                'FailedToFindEnoughLiquidityOnPathsToFundSwap',
                {available_liquidity: liquidity},
              ]);
            });
          }

          return cbk(null, {paths});
        });
      }],

      // Get a funding route for a single path payment
      findRoutesForFunding: [
        'channel',
        'decodeFundingRequest',
        'findPeer',
        'getFundingRoutes',
        'getIgnores',
        'getService',
        'requestSwap',
        ({
          channel,
          decodeFundingRequest,
          findPeer,
          getIgnores,
          getService,
          requestSwap,
        },
        cbk) =>
      {
        if (!!args.recovery) {
          return cbk();
        }

        // Exit early when doing multiple paths
        if ((args.max_paths || defaultMaxPaths) > 1) {
          return cbk();
        }

        const hasFeatures = !!decodeFundingRequest.features.length;
        const {tokens} = decodeFundingRequest;

        return getRoutesForFunding({
          cltv_delta: decodeFundingRequest.cltv_delta + cltvBuffer,
          destination: decodeFundingRequest.destination,
          features: !!hasFeatures ? decodeFundingRequest.features : undefined,
          ignore: getIgnores.ignore,
          lnd: args.lnd,
          logger: args.logger,
          max_fee: round(tokens / maxRoutingFeeDenominator),
          max_paths: args.max_paths || defaultMaxPaths,
          mtokens: decodeFundingRequest.mtokens,
          out_through: findPeer.public_key || undefined,
          outgoing_channel: !!channel ? channel.id : undefined,
          payment: decodeFundingRequest.payment,
          request: requestSwap.fund_request,
          routes: decodeFundingRequest.routes,
          tokens: decodeFundingRequest.tokens,
        },
        (err, res) => {
          if (!!err) {
            return cancelSwapOut({
              id: decodeFundingRequest.id,
              metadata: getService.metadata,
              payment: decodeFundingRequest.payment,
              service: getService.service,
            },
            () => cbk(err, res));
          }

          return cbk(null, res);
        });
      }],

      // Get info about the peer we are going to get inbound liquidity with
      getSwapPeers: [
        'findPeer',
        'findRoutesForFunding',
        'getChannels',
        'getFundingRoutes',
        'getPeerDetails',
        ({
          findPeer,
          findRoutesForFunding,
          getChannels,
          getFundingRoutes,
          getPeerDetails,
        },
        cbk) =>
      {
        // Exit early when this is a recovery
        if (!!args.recovery) {
          return cbk();
        }

        // Exit early when a peer is specified
        if (!!findPeer.public_key) {
          return cbk(null, [{
            alias: getPeerDetails.alias || undefined,
            peer_channels: getChannels.channels.filter(channel => {
              return channel.partner_public_key === findPeer.public_key;
            }),
            public_key: findPeer.public_key,
          }]);
        }

        // Exit early when the funding routes are found
        if (!!getFundingRoutes) {
          return asyncMap(getFundingRoutes.paths, (path, cbk) => {
            const [outPeer] = path.relays;

            return getNode({
              is_omitting_channels: true,
              lnd: args.lnd,
              public_key: outPeer,
            },
            (err, res) => {
              return cbk(null, {
                alias: !!res ? res.alias : undefined,
                peer_channels: getChannels.channels.filter(channel => {
                  return channel.partner_public_key === outPeer;
                }),
                public_key: outPeer,
              });
            });
          },
          cbk);
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
        'getFundingRoutes',
        'getLimits',
        'getService',
        'getSwapPeers',
        ({
          currency,
          decodeExecutionRequest,
          decodeFundingRequest,
          findRouteForExecution,
          findRoutesForFunding,
          getLimits,
          getService,
          getSwapPeers,
        },
        cbk) =>
      {
        // Exit early when this is a recovery
        if (!!args.recovery) {
          return cbk();
        }

        const executionRoutingFee = findRouteForExecution.fee || Number();
        const executionSend = decodeExecutionRequest.tokens;
        const fundingRoutingFee = (findRoutesForFunding || {}).fee || Number();
        const fundingSend = decodeFundingRequest.tokens;
        const increase = `${tokensAsBigUnit(args.tokens)} ${currency}`;
        const peerChannels = flatten(getSwapPeers.map(n => n.peer_channels));

        const peerIn = peerChannels.map(n => n.remote_balance);
        const peerOut = peerChannels.map(n => n.local_balance);
        const routingFees = executionRoutingFee + fundingRoutingFee;
        const serviceFee = fundingSend + executionSend - args.tokens;

        return getChainFeeRate({
          confirmation_target: getLimits.max_cltv_delta,
          lnd: args.lnd,
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          const sweepFee = res.tokens_per_vbyte * estimatedSweepVbytes;

          const allFees = ceil(serviceFee + sweepFee + routingFees);

          if (allFees > args.max_fee) {
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
            return cancelSwapOut({
              id: decodeFundingRequest.id,
              metadata: getService.metadata,
              payment: decodeFundingRequest.payment,
              service: getService.service,
            },
            err => {
              return cbk([500, 'InboundLiquidityIncreaseDryRun']);
            });
          }

          return cbk(null, {non_funding_routing_fees: allFees});
        });
      }],

      // Details of the swap to complete
      swap: [
        'getMinSweepFee',
        'recover',
        'requestSwap',
        'startSwap',
        ({recover, requestSwap, startSwap}, cbk) =>
      {
        // Exit early when recovering an in-progress swap
        if (!!args.recovery) {
          return cbk(null, {
            is_external_funding: recover.is_external_funding,
            is_loop_service: recover.is_loop_service,
            max_fee_deposit: recover.max_deposit_fee,
            min_confirmations: recover.min_confirmations,
            recovery: recover.recovery,
            response: recover.response,
            sweep_address: recover.sweep_address,
          });
        }

        // Funding payments are made here with the chosen routes
        return cbk(null, {
          is_external_funding: true,
          is_loop_service: true,
          max_fee_deposit: maxExecutionFeeTokens,
          min_confirmations: args.confs,
          recovery: startSwap.recovery,
          response: requestSwap.response,
          sweep_address: args.out_address,
        });
      }],

      // Complete the swap on chain once the swap service funds the swap
      complete: ['checkPayments', 'swap', ({swap}, cbk) => {
        const emitter = new EventEmitter();

        emitter.on('update', update => {
          // Exit early when the update is a payment that is being made here
          if (!args.recovery && isPayUpdate(update)) {
            return;
          }

          return args.logger.info(update);
        });

        return completeOffToOnSwap({
          emitter,
          is_external_funding: swap.is_external_funding,
          is_loop_service: swap.is_loop_service,
          lnd: args.lnd,
          max_fee_deposit: swap.max_fee_deposit,
          max_fee_funding: args.max_fee,
          min_confirmations: swap.min_confirmations,
          recovery: swap.recovery,
          response: swap.response,
          socket: args.socket,
          sweep_address: swap.sweep_address,
        },
        cbk);
      }],

      // Multi pay to swap fund
      multiPayToFund: [
        'decodeFundingRequest',
        'getFundingRoutes',
        'getMinSweepFee',
        ({decodeFundingRequest, getFundingRoutes, getMinSweepFee}, cbk) =>
      {
        // Exit early when there are no multiple funding paths
        if (!getFundingRoutes) {
          return cbk();
        }

        const sub = subscribeToMultiPathPay({
          cltv_delta: decodeFundingRequest.cltv_delta + cltvDeltaBuffer,
          destination: decodeFundingRequest.destination,
          id: decodeFundingRequest.id,
          lnd: args.lnd,
          max_fee: args.max_fee - getMinSweepFee.non_funding_routing_fees,
          mtokens: decodeFundingRequest.mtokens,
          paths: getFundingRoutes.paths,
          payment: decodeFundingRequest.payment,
          routes: decodeFundingRequest.routes,
        });

        sub.on('error', err => {
          return cbk([503, 'UnexpectedErrorPayingSwapFundingRequest', {err}]);
        });

        sub.on('failure', () => {
          return cbk([503, 'FailedToPayFundingPaymentRequest']);
        });

        sub.on('paid', ({secret}) => args.logger.info({proof: secret}));

        sub.on('paying', async ({route}) => {
          const {description} = await describeRoute({route, lnd: args.lnd});

          return args.logger.info({
            amount: route.tokens,
            paying: description,
          });
        });

        sub.on('routing_failure', async ({index, reason, route}) => {
          if (reason === 'MppTimeout') {
            return;
          }

          const {description} = await describeRoutingFailure({
            index,
            reason,
            route,
            lnd: args.lnd,
          });

          return args.logger.info({failure: description});
        });

        sub.on('success', ({}) => cbk());

        return;
      }],

      // Pay to swap funding
      payToFund: [
        'decodeFundingRequest',
        'findRoutesForFunding',
        'getMinSweepFee',
        ({decodeFundingRequest, findRoutesForFunding}, cbk) =>
      {
        // Exit early when there is no single path funding
        if (!findRoutesForFunding) {
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

          return cbk();
        });
      }],

      // Pay to swap execution
      payToExecute: [
        'channel',
        'deadline',
        'decodeExecutionRequest',
        'getMinSweepFee',
        'requestSwap',
        ({channel, deadline, decodeExecutionRequest, requestSwap}, cbk) =>
      {
        // Exit early when the swap is in a recovery mode already
        if (!!args.recovery) {
          return cbk();
        }

        args.logger.info({
          paying_execution_request: decodeExecutionRequest.id,
          estimated_swap_start_time: moment(deadline).calendar(),
        });

        const sub = subscribeToPayViaRequest({
          lnd: args.lnd,
          max_fee: maxExecutionFeeTokens,
          outgoing_channel: !!channel ? channel.id : undefined,
          pathfinding_timeout: maxPathfindingMs,
          request: requestSwap.deposit_request,
        });

        const finished = (err, res) => {
          sub.removeAllListeners();

          return cbk(err, res);
        };

        sub.once('confirmed', ({mtokens}) => finished(null, {mtokens}));

        sub.once('end', () => finished([503, 'FailedToResolveSwapExecution']));

        sub.once('error', err => {
          return finished([503, 'UnexpectedErrorPayingFundingRequest', {err}]);
        });

        sub.once('failed', failed => {
          if (!!failed.is_pathfinding_timeout) {
            return finished([503, 'TimedOutFindingALightningRoute']);
          }

          return finished([503, 'UnexpectedOutcomeOfSwapFailure', {failed}]);
        });
      }],

      // Finished
      summary: [
        'complete',
        'currency',
        'multiPayToFund',
        'payToExecute',
        'payToFund',
        ({complete, currency}, cbk) =>
      {
        const chainFee = complete.paid_chain_fee;
        const serviceFee = complete.paid_swap_fee || Number();
        const totalFee = complete.total_fee;

        const routingFees = [
          complete.paid_execution_routing_fee,
          complete.paid_funding_routing_fee,
        ];

        const routingFee = sumOf(routingFees.filter(n => !!n));

        // The off-chain spend is the swap amount plus the off-chain fees
        const increase = complete.tokens + totalFee - chainFee;

        args.logger.info({
          completed: moment().calendar(),
          inbound_increased: `${tokensAsBigUnit(increase)} ${currency}`,
          chain_fee_paid: `${tokensAsBigUnit(chainFee)} ${currency}`,
          routing_fee_paid: `${tokensAsBigUnit(routingFee)} ${currency}`,
          service_fee_paid: `${tokensAsBigUnit(serviceFee)} ${currency}`,
          total_fee_paid: `${tokensAsBigUnit(totalFee)} ${currency}`,
        });

        return cbk();
      }],
    },
    returnResult({reject, resolve, of: 'summary'}, cbk));
  });
};
