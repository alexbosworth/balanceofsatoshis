const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const asyncMapSeries = require('async/mapSeries');
const asyncRetry = require('async/retry');
const {createInvoice} = require('ln-service');
const {findKey} = require('ln-sync');
const {getChannel} = require('ln-service');
const {getChannels} = require('ln-service');
const {getHeight} = require('ln-service');
const {getIdentity} = require('ln-service');
const {getNode} = require('ln-service');
const {getPeerLiquidity} = require('ln-sync');
const {getRouteThroughHops} = require('ln-service');
const {getWalletVersion} = require('ln-service');
const {parseAmount} = require('ln-accounting');
const {payViaRoutes} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {routeFromChannels} = require('ln-service');

const {findTagMatch} = require('./../peers');
const {formatFeeRate} = require('./../display');
const {getIgnores} = require('./../routing');
const {homePath} = require('../storage');
const {probeDestination} = require('./../network');
const {sortBy} = require('./../arrays');

const asRate = (fee, tokens) => ({rate: Math.ceil(fee / tokens * 1e6)});
const {ceil} = Math;
const channelMatch = /^\d*x\d*x\d*$/;
const cltvDelta = 144;
const defaultCltvDelta = 40;
const defaultMaxFee = 1337;
const defaultMaxFeeRate = 250;
const defaultMaxFeeTotal = Math.floor(5e6 * 0.0025);
const flatten = arr => [].concat(...arr);
const highInbound = 4500000;
const initialProbeTokens = size => Math.round((Math.random() * size) + size);
const interval = 1000 * 10;
const {isArray} = Array;
const isPublicKey = n => /^[0-9A-F]{66}$/i.test(n);
const legacyMaxRebalanceTokens = 4294967;
const {max} = Math;
const maxPaymentSize = 4294967;
const {min} = Math;
const minInboundBalance = 4294967 * 2;
const minRebalanceAmount = 5e4;
const minRemoteBalance = 4294967;
const minTokens = 0;
const minimalRebalanceAmount = 2e5;
const mtokensPerToken = BigInt(1e3);
const notFoundIndex = -1;
const {parse} = JSON;
const probeSizeMinimal = 1e2;
const probeSizeRegular = 2e5
const pubKeyHexLength = 66;
const rateDivisor = 1e6;
const sample = a => !!a.length ? a[Math.floor(Math.random()*a.length)] : null;
const sumOf = arr => arr.reduce((sum, n) => sum + n);
const tagFilePath = () => homePath({file: 'tags.json'}).path;
const times = 6;
const tokAsBigTok = tokens => !tokens ? undefined : (tokens / 1e8).toFixed(8);
const topOf = arr => arr.slice(0, Math.ceil(arr.length / 2));
const uniq = arr => Array.from(new Set(arr));

/** Rebalance funds between peers

  {
    [avoid]: [<Avoid Forwarding Through Node With Public Key Hex String>]
    fs: {
      getFile: <Read File Contents Function> (path, cbk) => {}
    }
    [in_filters]: [<Inbound Filter Formula String>]
    [in_outbound]: <Inbound Target Outbound Liquidity Tokens Number>
    [in_through]: <Pay In Through Peer String>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    [max_fee]: <Maximum Fee Tokens Number>
    [max_fee_rate]: <Max Fee Rate Tokens Per Million Number>
    [max_rebalance]: <Maximum Amount to Rebalance Tokens String>
    [node]: <Node Name String>
    [out_filters]: [<Outbound Filter Formula String>]
    [out_inbound]: <Outbound Target Inbound Liquidity Tokens Number>
    [out_through]: <Pay Out Through Peer String>
    [timeout_minutes]: <Deadline To Stop Rebalance Minutes Number>
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.fs) {
          return cbk([400, 'ExpectedFsToRebalance']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToRebalance'])
        }

        if (isArray(args.in_through)) {
          return cbk([400, 'MultipleInPeersIsNotSupported']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToExecuteRebalance']);
        }

        if (args.max_fee === 0) {
          return cbk([400, 'ExpectedNonZeroMaxFeeForRebalance']);
        }

        if (args.max_fee_rate === 0) {
          return cbk([400, 'ExpectedNonZeroMaxFeeRateForRebalance']);
        }

        if (isArray(args.out_through)) {
          return cbk([400, 'MultipleOutPeersIsNotSupported']);
        }

        return cbk();
      },

      // Determine the maximum rebalance
      maximum: ['validate', ({}, cbk) => {
        // Exit early when there is no maximum rebalance target
        if (!args.max_rebalance) {
          return cbk();
        }

        try {
          const {tokens} = parseAmount({amount: args.max_rebalance});

          if (tokens < minRebalanceAmount) {
            return cbk([400, 'LowRebalanceAmount', {min: minRebalanceAmount}]);
          }

          return cbk(null, tokens);
        } catch (err) {
          return cbk([400, err.message]);
        }
      }],

      // Starting tokens to rebalance
      tokens: ['maximum', ({maximum}, cbk) => {
        if (!!maximum && maximum < minRebalanceAmount) {
          return cbk(null, initialProbeTokens(probeSizeMinimal));
        }

        return cbk(null, initialProbeTokens(probeSizeRegular));
      }],

      // Lnd by itself
      lnd: ['validate', ({}, cbk) => cbk(null, args.lnd)],

      // Get the set of tags
      getTags: ['validate', ({}, cbk) => {
        const defaultTags = {tags: []};

        return args.fs.getFile(tagFilePath(), (err, res) => {
          if (!!err || !res) {
            return cbk(null, defaultTags);
          }

          try {
            const {tags} = parse(res.toString());

            return cbk(null, {tags});
          } catch (err) {
            return cbk(null, defaultTags);
          }
        });
      }],

      // Get initial liquidity
      getInitialLiquidity: ['lnd', ({lnd}, cbk) => getChannels({lnd}, cbk)],

      // Get public key
      getPublicKey: ['lnd', ({lnd}, cbk) => getIdentity({lnd}, cbk)],

      // Figure out which public keys and channels to avoid
      ignore: [
        'getInitialLiquidity',
        'getPublicKey',
        'getTags',
        'lnd',
        ({getInitialLiquidity, getPublicKey, getTags, lnd}, cbk) =>
      {
        return getIgnores({
          lnd,
          avoid: args.avoid,
          channels: getInitialLiquidity.channels,
          in_through: args.in_through,
          logger: args.logger,
          public_key: getPublicKey.public_key,
          tags: getTags.tags,
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          return cbk(null, res.ignore);
        });
      }],

      // Get fee rates
      getFees: ['getPublicKey', 'lnd', ({getPublicKey, lnd}, cbk) => {
        return getNode({lnd, public_key: getPublicKey.public_key}, cbk);
      }],

      // Find inbound tag public key
      findInTag: [
        'getFees',
        'getInitialLiquidity',
        'getPublicKey',
        'getTags',
        ({getFees, getInitialLiquidity, getPublicKey, getTags}, cbk) =>
      {
        const id = getPublicKey.public_key;

        const {failure, match, matches} = findTagMatch({
          channels: getInitialLiquidity.channels.filter(n => n.is_active),
          filters: args.in_filters,
          policies: getFees.channels.map(channel => {
            const policy = channel.policies.find(n => n.public_key !== id);

            return {
              fee_rate: policy.fee_rate,
              is_disabled: policy.is_disabled,
              public_key: policy.public_key,
            };
          }),
          tags: getTags.tags,
          query: args.in_through,
        });

        // Exit early when there is a filter error
        if (!!failure) {
          return cbk([400, 'FailedToParseFilter', failure]);
        }

        if (!!matches) {
          return cbk([400, 'MultipleTagMatchesFoundForInPeer', {matches}]);
        }

        if (!match && !!args.in_filters && !!args.in_filters.length) {
          return cbk([400, 'NoPeerMatchesFoundToSatisfyInboundFilter']);
        }

        return cbk(null, match);
      }],

      // Find inbound peer key if a name is specified
      findInKey: [
        'findInTag',
        'getInitialLiquidity',
        'lnd',
        ({findInTag, getInitialLiquidity, lnd}, cbk) =>
      {
        if (!!findInTag) {
          return cbk(null, findInTag);
        }

        return findKey({
          lnd,
          channels: getInitialLiquidity.channels,
          query: args.in_through,
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          return cbk(null, res.public_key);
        });
      }],

      // Find outbound peer key if a name is specified
      findOutKey: [
        'findInTag',
        'getFees',
        'getInitialLiquidity',
        'getPublicKey',
        'getTags',
        'lnd',
        ({
          findInTag,
          getFees,
          getInitialLiquidity,
          getPublicKey,
          getTags,
          lnd,
        },
        cbk) =>
      {
        const id = getPublicKey.public_key;

        const {failure, match, matches} = findTagMatch({
          channels: getInitialLiquidity.channels.filter(n => n.is_active),
          filters: args.out_filters,
          policies: getFees.channels.map(channel => {
            const policy = channel.policies.find(n => n.public_key !== id);

            return {fee_rate: policy.fee_rate, public_key: policy.public_key};
          }),
          tags: getTags.tags,
          query: args.out_through,
        });

        // Exit early when there is a filter error
        if (!!failure) {
          return cbk([400, 'FailedToParseFilter', failure]);
        }

        if (!!matches) {
          return cbk([400, 'MultipleTagMatchesFoundForOutPeer', {matches}]);
        }

        if (match) {
          return cbk(null, match);
        }

        if (!match && !!args.out_filters && !!args.out_filters.length) {
          return cbk([400, 'NoPeerMatchesFoundToSatisfyOutboundFilter']);
        }

        return findKey({
          lnd,
          channels: getInitialLiquidity.channels,
          query: args.out_through,
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          return cbk(null, res.public_key);
        });
      }],

      // Get outbound node details
      getOutbound: [
        'findInKey',
        'findOutKey',
        'getInitialLiquidity',
        'ignore',
        'lnd',
        'tokens',
        ({
          findInKey,
          findOutKey,
          getInitialLiquidity,
          ignore,
          lnd,
          tokens,
        },
        cbk) =>
      {
        const ban = ignore.filter(n => !n.channel).map(n => n.from_public_key);

        const active = getInitialLiquidity.channels
          .filter(n => !!n.is_active)
          .filter(n => !ban.includes(n.partner_public_key));

        const channels = active
          .filter(n => n.partner_public_key !== findInKey)
          .filter(n => n.local_balance - n.local_reserve > tokens)
          .map(channel => {
            const remote = active
              .filter(n => n.partner_public_key === channel.partner_public_key)
              .reduce((sum, n) => sum + n.remote_balance, minTokens);

            return {remote, partner_public_key: channel.partner_public_key};
          })
          .filter(n => n.remote < minRemoteBalance);

        // Exit early with error when an outbound channel cannot be guessed
        if (!args.out_through && !channels.length) {
          return cbk([400, 'NoOutboundChannelNeedsRebalance']);
        }

        const {sorted} = sortBy({array: channels, attribute: 'remote'});

        const key = findOutKey || sample(sorted).partner_public_key;

        const currentInbound = active
          .filter(n => n.partner_public_key === key)
          .map(n => n.remote_balance)
          .reduce((sum, n) => sum + n, minTokens);

        return getNode({
          lnd,
          is_omitting_channels: true,
          public_key: key,
        },
        (err, res) => {
          return cbk(null, {
            alias: !!res && !!res.alias ? `${res.alias} ${key}` : key,
            public_key: key,
          });
        });
      }],

      // Get inbound node details
      getInbound: [
        'findInKey',
        'getFees',
        'getInitialLiquidity',
        'getOutbound',
        'ignore',
        'lnd',
        ({
          findInKey,
          getFees,
          getInitialLiquidity,
          getOutbound,
          ignore,
          lnd,
        },
        cbk) =>
      {
        const ban = ignore.filter(n => !n.channel).map(n => n.from_public_key);
        const hasInThrough = !!args.in_through;

        const activeChannels = getInitialLiquidity.channels
          .filter(n => !!n.is_active)
          .filter(n => n.partner_public_key !== getOutbound.public_key)
          .filter(n => !ban.includes(n.partner_public_key));

        // Sum up the remote balance of active channels
        const remote = activeChannels.reduce((sum, channel) => {
          const key = channel.partner_public_key;

          sum[key] = sum[key] || Number();

          sum[key] = sum[key] + channel.remote_balance;

          return sum;
        },
        {});

        const channels = activeChannels
          .filter(channel => {
            const key = channel.partner_public_key;

            return hasInThrough || remote[key] > minInboundBalance;
          })
          .map(channel => {
            const remote = activeChannels
              .filter(n => n.partner_public_key === channel.partner_public_key)
              .reduce((sum, n) => sum + n.remote_balance, minTokens);

            return {
              remote,
              id: channel.id,
              partner_public_key: channel.partner_public_key,
            };
          });

        if (!channels.length) {
          return cbk([400, 'NoInboundChannelIsAvailableToReceiveRebalance']);
        }

        // Filter out channels where the inbound fee rate is too expensive
        const array = channels.filter(chan => {
          const peerKey = chan.partner_public_key;

          const policies = getFees.channels.map(({policies}) => {
            return policies.find(n => n.public_key === peerKey);
          });

          const feeRates = policies.filter(n => !!n).map(n => n.fee_rate);

          const feeRate = max(...feeRates);

          return feeRate < (args.max_fee_rate || defaultMaxFeeRate);
        });

        // Exit early when there is no obvious inbound peer
        if (!findInKey && !array.length) {
          return cbk([400, 'NoHighInboundLowFeeChannelToReceiveRebalance']);
        }

        const {sorted} = sortBy({array, attribute: 'remote'});

        const suggestedInbound = sample(topOf(sorted.slice().reverse()));

        const key = findInKey || suggestedInbound.partner_public_key;

        return getNode({
          lnd,
          is_omitting_channels: true,
          public_key: key,
        },
        (err, res) => {
          return cbk(null, {
            alias: !!res && !!res.alias ? `${res.alias} ${key}` : key,
            public_key: key,
          });
        });
      }],

      // Calculate maximum amount to rebalance
      max: [
        'getInbound',
        'getOutbound',
        'maximum',
        'tokens',
        ({getInbound, getOutbound, maximum, tokens}, cbk) =>
      {
        if (!!maximum && !!args.in_outbound) {
          return cbk([400, 'CannotSpecifyBothDiscreteAmountAndTargetAmounts']);
        }

        if (!!maximum && !!args.out_inbound) {
          return cbk([400, 'CannotSpecifyBothDiscreteAmountAndTargetAmounts']);
        }

        if (!!args.in_outbound && !!args.out_inbound) {
          return cbk([400, 'TargetingBothInAndOutAmountsNotSupported']);
        }

        if (!args.in_outbound && !args.out_inbound) {
          return cbk(null, maximum || maxPaymentSize);
        }

        const amount = !args.in_outbound ? args.out_inbound : args.in_outbound;

        const peer = !args.in_outbound ? getOutbound : getInbound;

        return getPeerLiquidity({
          lnd: args.lnd,
          public_key: peer.public_key,
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          const variables = {capacity: sumOf([res.inbound, res.outbound])};

          try {
            parseAmount({amount, variables});
          } catch (err) {
            return cbk([400, err.message]);
          }

          const target = parseAmount({amount, variables}).tokens;

          const current = !args.in_outbound ? res.inbound : res.outbound;

          if (current > target - tokens) {
            return cbk([400, 'AlreadyEnoughLiquidityForPeer']);
          }

          return cbk(null, target - current);
        });
      }],

      // Find a route to the destination
      findRoute: [
        'findInKey',
        'findOutKey',
        'getInbound',
        'getOutbound',
        'getPublicKey',
        'ignore',
        'max',
        'tokens',
        ({
          findInKey,
          findOutKey,
          getInbound,
          getOutbound,
          getPublicKey,
          ignore,
          max,
          tokens,
        },
        cbk) =>
      {
        args.logger.info({
          outgoing_peer_to_increase_inbound: getOutbound.alias,
          incoming_peer_to_decrease_inbound: getInbound.alias,
          rebalance_target_amount: tokAsBigTok(max),
        });

        const immediateIgnore = [{
          from_public_key: getPublicKey.public_key,
          to_public_key: getInbound.public_key,
        }];

        if (getInbound.public_key === getOutbound.public_key) {
          return cbk([400, 'ExpectedDifferentPeersForInboundAndOutbound']);
        }

        return probeDestination({
          tokens,
          destination: getPublicKey.public_key,
          find_max: max,
          fs: args.fs,
          ignore: [].concat(immediateIgnore).concat(ignore).filter(n => {
            if (!!n.to_public_key) {
              return true;
            }

            // Never generally avoid directly specified keys
            return ![findInKey, findOutKey].includes(n.from_public_key);
          }),
          in_through: getInbound.public_key,
          logger: args.logger,
          lnd: args.lnd,
          max_fee: defaultMaxFeeTotal,
          out_through: getOutbound.public_key,
          timeout_minutes: args.timeout_minutes,
        },
        cbk);
      }],

      // Get channels for the rebalance route
      channels: [
        'findRoute',
        'getInitialLiquidity',
        'getPublicKey',
        'lnd',
        ({findRoute, getPublicKey, lnd}, cbk) =>
      {
        if (!findRoute.success) {
          return cbk([400, 'FailedToFindPathBetweenPeers']);
        }

        let from = getPublicKey.public_key;

        return asyncMapSeries(findRoute.success, (id, cbk) => {
          return getChannel({id, lnd}, (err, channel) => {
            if (!!err) {
              return cbk(err);
            }

            const {capacity} = channel;
            const {policies} = channel;

            const to = policies.find(n => n.public_key !== from).public_key;

            // The next hop from will be this hop's to
            from = to;

            return cbk(null, {capacity, id, policies, destination: to});
          });
        },
        cbk);
      }],

      // Create local invoice
      invoice: ['channels', 'findRoute', 'lnd', ({findRoute, lnd}, cbk) => {
        return createInvoice({
          lnd,
          cltv_delta: defaultCltvDelta,
          description: 'Rebalance',
          tokens: findRoute.route_maximum,
        },
        cbk);
      }],

      // Get the current height
      getHeight: ['channels', 'lnd', ({lnd}, cbk) => getHeight({lnd}, cbk)],

      // Get route for rebalance
      getRoute: ['channels', 'invoice', ({channels, invoice}, cbk) => {
        return getRouteThroughHops({
          cltv_delta: cltvDelta,
          lnd: args.lnd,
          mtokens: invoice.mtokens,
          payment: invoice.payment,
          public_keys: channels.map(n => n.destination),
          total_mtokens: !!invoice.payment ? invoice.mtokens : undefined,
        },
        (err, res) => {
          // Exit early when there is an error and use local route calculation
          if (!!err) {
            return cbk(null, {});
          }

          return cbk(null, {route: res.route});
        });
      }],

      // Calculate route for rebalance
      routes: [
        'channels',
        'getHeight',
        'getPublicKey',
        'getRoute',
        'invoice',
        'tokens',
        ({
          channels,
          getHeight,
          getPublicKey,
          getRoute,
          invoice,
          tokens,
        },
        cbk) =>
      {
        try {
          const {route} = routeFromChannels({
            channels,
            cltv_delta: cltvDelta,
            destination: getPublicKey.public_key,
            height: getHeight.current_block_height,
            mtokens: (BigInt(invoice.tokens) * mtokensPerToken).toString(),
            payment: invoice.payment,
            total_mtokens: !!invoice.payment ? invoice.mtokens : undefined,
          });

          const endRoute = getRoute.route || route;
          const maxFee = args.max_fee || defaultMaxFee;
          const maxFeeRate = args.max_fee_rate || defaultMaxFeeRate;

          if (endRoute.tokens < minRebalanceAmount) {
            return cbk([503, 'EncounteredUnexpectedRouteLiquidityFailure']);
          }

          const [highFeeAt] = sortBy({
            array: endRoute.hops.map(hop => ({
              to: hop.public_key,
              fee: hop.fee,
            })),
            attribute: 'fee',
          }).sorted.reverse().map(n => n.to);

          // Exit early when a max fee is specified and exceeded
          if (!!maxFee && endRoute.fee > maxFee) {
            return cbk([
              400,
              'RebalanceTotalFeeTooHigh',
              {needed_max_fee: endRoute.fee.toString(), high_fee: highFeeAt},
            ]);
          }

          const feeRate = ceil(endRoute.fee / endRoute.tokens * rateDivisor);

          // Exit early when the max fee rate is specified and exceeded
          if (!!maxFeeRate && feeRate > maxFeeRate) {
            return cbk([
              400,
              'RebalanceFeeRateTooHigh',
              {needed_max_fee_rate: feeRate.toString(), high_fee: highFeeAt},
            ]);
          }

          return cbk(null, [endRoute]);
        } catch (err) {
          return cbk([500, 'FailedToConstructRebalanceRoute', {err}]);
        }
      }],

      // Execute the rebalance
      pay: ['invoice', 'lnd', 'routes', ({invoice, lnd, routes}, cbk) => {
        return payViaRoutes({lnd, routes, id: invoice.id}, (err, res) => {
          if (!!err) {
            return cbk([503, 'UnexpectedErrExecutingRebalance', {err}]);
          }

          return cbk(null, {
            fee: res.fee,
            id: invoice.id,
            tokens: res.tokens,
          });
        });
      }],

      // Get adjusted inbound liquidity after rebalance
      getAdjustedInbound: ['getInbound', 'pay', ({getInbound, pay}, cbk) => {
        return getPeerLiquidity({
          lnd: args.lnd,
          public_key: getInbound.public_key,
          settled: pay.id,
        },
        cbk);
      }],

      // Get adjusted outbound liquidity after rebalance
      getAdjustedOutbound: ['getOutbound', 'pay', ({getOutbound, pay}, cbk) => {
        return getPeerLiquidity({
          lnd: args.lnd,
          public_key: getOutbound.public_key,
          settled: pay.id,
        },
        cbk);
      }],

      // Final rebalancing outcome
      rebalance: [
        'getAdjustedInbound',
        'getAdjustedOutbound',
        'getInbound',
        'getOutbound',
        'pay',
        ({
          getAdjustedInbound,
          getAdjustedOutbound,
          getInbound,
          getOutbound,
          pay,
        },
        cbk) =>
      {
        const feeRate = formatFeeRate(asRate(pay.fee, pay.tokens)).display;
        const inOn = getAdjustedOutbound.alias || getOutbound.public_key;
        const inOpeningIn = getAdjustedInbound.inbound_opening;
        const inOpeningOut = getAdjustedInbound.outbound_opening;
        const inPendingIn = getAdjustedInbound.inbound_pending;
        const inPendingOut = getAdjustedInbound.outbound_pending;
        const outOn = getAdjustedInbound.alias || getInbound.public_key;
        const outOpeningIn = getAdjustedOutbound.inbound_opening;
        const outOpeningOut = getAdjustedOutbound.outbound_opening;
        const outPendingIn = getAdjustedOutbound.inbound_pending;
        const outPendingOut = getAdjustedOutbound.outbound_pending;

        return cbk(null, {
          rebalance: [
            {
              increased_inbound_on: inOn,
              liquidity_inbound: tokAsBigTok(getAdjustedOutbound.inbound),
              liquidity_inbound_opening: tokAsBigTok(outOpeningIn),
              liquidity_inbound_pending: tokAsBigTok(outPendingIn),
              liquidity_outbound: tokAsBigTok(getAdjustedOutbound.outbound),
              liquidity_outbound_opening: tokAsBigTok(outOpeningOut),
              liquidity_outbound_pending: tokAsBigTok(outPendingOut),
            },
            {
              decreased_inbound_on: outOn,
              liquidity_inbound: tokAsBigTok(getAdjustedInbound.inbound),
              liquidity_inbound_opening: tokAsBigTok(inOpeningIn),
              liquidity_inbound_pending: tokAsBigTok(inPendingIn),
              liquidity_outbound: tokAsBigTok(getAdjustedInbound.outbound),
              liquidity_outbound_opening: tokAsBigTok(inOpeningOut),
              liquidity_outbound_pending: tokAsBigTok(inPendingOut),
            },
            {
              rebalanced: tokAsBigTok(pay.tokens),
              rebalance_fees_spent: tokAsBigTok(pay.fee),
              rebalance_fee_rate: feeRate,
            },
          ],
        });
      }],
    },
    returnResult({reject, resolve, of: 'rebalance'}, cbk));
  });
};
