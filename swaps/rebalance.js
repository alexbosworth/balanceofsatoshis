const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const asyncMapSeries = require('async/mapSeries');
const asyncRetry = require('async/retry');
const {createInvoice} = require('ln-service');
const {getChannel} = require('ln-service');
const {getChannels} = require('ln-service');
const {getNode} = require('ln-service');
const {getRouteThroughHops} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {payViaRoutes} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {routeFromChannels} = require('ln-service');

const {findKey} = require('./../peers');
const {getPeerLiquidity} = require('./../balances');
const {probeDestination} = require('./../network');
const {sortBy} = require('./../arrays');

const {ceil} = Math;
const channelMatch = /^\d*x\d*x\d*$/;
const cltvDelta = 144;
const defaultCltvDelta = 40;
const defaultMaxFee = 1337;
const defaultMaxFeeRate = 250;
const defaultMaxFeeTotal = Math.floor(5e6 * 0.0025);
const flatten = arr => [].concat(...arr);
const highInbound = 4500000;
const {isArray} = Array;
const isPublicKey = n => /^[0-9A-F]{66}$/i.test(n);
const {max} = Math;
const maxPaymentSize = 4294967;
const maxRebalanceTokens = 4294967;
const {min} = Math;
const minInboundBalance = 4294967 * 2;
const minRemoteBalance = 4294967;
const minTokens = 0;
const mtokensPerToken = BigInt(1e3);
const notFoundIndex = -1;
const pubKeyHexLength = 66;
const rateDivisor = 1e6;
const sample = a => !!a.length ? a[Math.floor(Math.random()*a.length)] : null;
const tokAsBigTok = tokens => !tokens ? undefined : (tokens / 1e8).toFixed(8);
const topOf = arr => arr.slice(0, Math.ceil(arr.length / 2));
const uniq = arr => Array.from(new Set(arr));

/** Rebalance funds between peers

  {
    [avoid]: [<Avoid Forwarding Through Node With Public Key Hex String>]
    [in_through]: <Pay In Through Peer String>
    [is_avoiding_high_inbound]: <Avoid High Inbound Liquidity Bool>
    lnd: <Authenticated LND gRPC API Object>
    logger: <Winston Logger Object>
    [max_fee]: <Maximum Fee Tokens Number>
    [max_fee_rate]: <Max Fee Rate Tokens Per Million Number>
    [max_rebalance]: <Maximum Amount to Rebalance Tokens Number>
    [node]: <Node Name String>
    [out_channels]: [<Exclusively Rebalance Through Channel Ids String>]
    out_through: <Pay Out Through Peer String>
    [target]: <Target Tokens Number>
    [timeout_minutes]: <Deadline To Stop Rebalance Minutes Number>
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Starting tokens to rebalance
      tokens: cbk => {
        return cbk(null, Math.round((Math.random() * 1e5) + 1e5));
      },

      // Check arguments
      validate: cbk => {
        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToRebalance'])
        }

        if (isArray(args.in_through)) {
          return cbk([400, 'MultipleInPeersIsNotSupported']);
        }

        if (!!args.in_through && args.in_through === args.out_through) {
          return cbk([400, 'ExpectedInPeerNotEqualToOutPeer']);
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

        if (!!args.out_through && args.in_through === args.out_through) {
          return cbk([400, 'ExpectedOutPeerNotEqualToInPeer']);
        }

        return cbk();
      },

      // Lnd by itself
      lnd: ['validate', ({}, cbk) => cbk(null, args.lnd)],

      // Get initial liquidity
      getInitialLiquidity: ['lnd', ({lnd}, cbk) => getChannels({lnd}, cbk)],

      // Get public key
      getPublicKey: ['lnd', ({lnd}, cbk) => getWalletInfo({lnd}, cbk)],

      // Figure out which public keys and channels to avoid
      ignore: [
        'getInitialLiquidity',
        'getPublicKey',
        'lnd',
        ({getInitialLiquidity, getPublicKey, lnd}, cbk) =>
      {
        return asyncMap(args.avoid || [], (id, cbk) => {
          // Exit early when the id is a public key
          if (isPublicKey(id)) {
            return cbk(null, {from_public_key: id});
          }

          // Exit early when the id is a peer query
          if (!channelMatch.test(id)) {
            return findKey({
              lnd,
              channels: getInitialLiquidity.channels,
              query: id,
            },
            (err, res) => {
              if (!!err) {
                return cbk(err);
              }

              return cbk(null, {from_public_key: res.public_key});
            });
          }

          return getChannel({id, lnd: args.lnd}, (err, res) => {
            if (!!err) {
              return cbk([404, 'FailedToFindChannelToAvoid', {err}]);
            }

            const [node1, node2] = res.policies.map(n => n.public_key);

            const ignore = [
              {channel: id, from_public_key: node1, to_public_key: node2},
              {channel: id, from_public_key: node2, to_public_key: node1},
            ];

            return cbk(null, ignore);
          });
        },
        (err, ignore) => {
          if (!!err) {
            return cbk(err);
          }

          const allIgnores = flatten(ignore).filter(n => {
            const isFromInThrough = n.from_public_key === args.in_through;
            const isFromSelf = n.from_public_key === getPublicKey.public_key;
            const isToOutThrough = n.to_public_key === args.out_through;
            const isToSelf = n.to_public_key === getPublicKey.public_key;

            if (isFromSelf && isToOutThrough) {
              return false;
            }

            if (isToSelf && isFromInThrough) {
              return false;
            }

            return true;
          });

          return cbk(null, allIgnores);
        });
      }],

      // Get fee rates
      getFees: ['getPublicKey', 'lnd', ({getPublicKey, lnd}, cbk) => {
        return getNode({lnd, public_key: getPublicKey.public_key}, cbk);
      }],

      // Find inbound peer key if a name is specified
      findInKey: [
        'getInitialLiquidity',
        'lnd',
        ({getInitialLiquidity, lnd}, cbk) =>
      {
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
        'getInitialLiquidity',
        'lnd',
        ({getInitialLiquidity, lnd}, cbk) =>
      {
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

        if (!!args.out_through && !!args.out_channels.length) {
          const outChannels = getInitialLiquidity.channels
            .filter(n => n.partner_public_key === findOutKey)
            .map(n => n.id);

          if (outChannels.length !== args.out_channels.length) {
            return cbk([400, 'ExpectedAllOutChannels', {chans: outChannels}]);
          }

          if (!outChannels.every(n => args.out_channels.includes(n))) {
            return cbk([400, 'ExpectedAllOutChannels', {chans: outChannels}]);
          }
        }

        const {sorted} = sortBy({array: channels, attribute: 'remote'});

        const key = findOutKey || sample(sorted).partner_public_key;

        const currentInbound = active
          .filter(n => n.partner_public_key === key)
          .map(n => n.remote_balance)
          .reduce((sum, n) => sum + n, minTokens);

        if (args.is_avoiding_high_inbound && currentInbound > highInbound) {
          return cbk([400, 'InboundIsAlreadyHigh', {inbound: currentInbound}]);
        }

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
        if (!array.length) {
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
        'tokens',
        ({getInbound, getOutbound, tokens}, cbk) =>
      {
        if (!!args.max_rebalance && !!args.in_outbound) {
          return cbk([400, 'CannotSpecifyBothDiscreteAmountAndTargetAmounts']);
        }

        if (!!args.max_rebalance && !!args.out_inbound) {
          return cbk([400, 'CannotSpecifyBothDiscreteAmountAndTargetAmounts']);
        }

        if (!!args.in_outbound && !!args.out_inbound) {
          return cbk([400, 'TargetingBothInAndOutAmountsNotSupported']);
        }

        if (!args.in_outbound && !args.out_inbound) {
          return cbk(null, args.max_rebalance || maxPaymentSize);
        }

        const peer = !args.in_outbound ? getOutbound : getInbound;
        const target = !args.in_outbound ? args.out_inbound : args.in_outbound;

        return getPeerLiquidity({
          lnd: args.lnd,
          public_key: peer.public_key,
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          const current = !args.in_outbound ? res.inbound : res.outbound;

          if (current > target - tokens) {
            return cbk([400, 'AlreadyEnoughLiquidityForPeer']);
          }

          return cbk(null, min(...[maxPaymentSize, target - current]));
        });
      }],

      // Find a route to the destination
      findRoute: [
        'getInbound',
        'getOutbound',
        'getPublicKey',
        'ignore',
        'max',
        'tokens',
        ({getInbound, getOutbound, getPublicKey, ignore, max, tokens}, cbk) =>
      {
        args.logger.info({
          outgoing_peer: {
            alias: getOutbound.alias,
            public_key: getOutbound.public_key,
          },
          incoming_peer: {
            alias: getInbound.alias,
            public_key: getInbound.public_key,
          },
        });

        const immediateIgnore = [{
          from_public_key: getPublicKey.public_key,
          to_public_key: getInbound.public_key,
        }];

        return probeDestination({
          tokens,
          destination: getPublicKey.public_key,
          find_max: max,
          ignore: [].concat(immediateIgnore).concat(ignore),
          in_through: getInbound.public_key,
          logger: args.logger,
          lnd: args.lnd,
          max_fee: defaultMaxFeeTotal,
          node: args.node,
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
          tokens: min(maxRebalanceTokens, findRoute.route_maximum),
        },
        cbk);
      }],

      // Get the current height
      getHeight: ['channels', 'lnd', ({lnd}, cbk) => {
        return getWalletInfo({lnd}, cbk);
      }],

      // Get route for rebalance
      getRoute: ['channels', 'invoice', ({channels, invoice}, cbk) => {
        return getRouteThroughHops({
          cltv_delta: cltvDelta,
          lnd: args.lnd,
          mtokens: invoice.mtokens,
          public_keys: channels.map(n => n.destination),
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
        ({channels, getHeight, getPublicKey, getRoute, invoice}, cbk) =>
      {
        try {
          const {route} = routeFromChannels({
            channels,
            cltv_delta: cltvDelta,
            destination: getPublicKey.public_key,
            height: getHeight.current_block_height,
            mtokens: (BigInt(invoice.tokens) * mtokensPerToken).toString(),
          });

          const endRoute = getRoute.route || route;
          const maxFee = args.max_fee || defaultMaxFee;
          const maxFeeRate = args.max_fee_rate || defaultMaxFeeRate;

          // Exit early when a max fee is specified and exceeded
          if (!!maxFee && endRoute.fee > maxFee) {
            return cbk([
              400,
              'RebalanceTotalFeeTooHigh',
              {needed_max_fee: endRoute.fee},
            ]);
          }

          const feeRate = ceil(endRoute.fee / endRoute.tokens * rateDivisor);

          // Exit early when the max fee rate is specified and exceeded
          if (!!maxFeeRate && feeRate > maxFeeRate) {
            return cbk([
              400,
              'RebalanceFeeRateTooHigh',
              {needed_max_fee_rate: feeRate},
            ]);
          }

          return cbk(null, [endRoute]);
        } catch (err) {
          return cbk([500, 'FailedToConstructRebalanceRoute', {err}]);
        }
      }],

      // Execute the rebalance
      pay: ['invoice', 'lnd', 'routes', ({invoice, lnd, routes}, cbk) => {
        return asyncRetry({}, cbk => {
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
        },
        cbk);
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
        'pay',
        ({getAdjustedInbound, getAdjustedOutbound, pay}, cbk) =>
      {
        const inOpeningIn = getAdjustedInbound.inbound_opening;
        const inOpeningOut = getAdjustedInbound.outbound_opening;
        const inPendingIn = getAdjustedInbound.inbound_pending;
        const inPendingOut = getAdjustedInbound.outbound_pending;
        const outOpeningIn = getAdjustedOutbound.inbound_opening;
        const outOpeningOut = getAdjustedOutbound.outbound_opening;
        const outPendingIn = getAdjustedOutbound.inbound_pending;
        const outPendingOut = getAdjustedOutbound.outbound_pending;

        args.logger.info({
          rebalance: [
            {
              increased_inbound_on: getAdjustedOutbound.alias,
              liquidity_inbound: tokAsBigTok(getAdjustedOutbound.inbound),
              liquidity_inbound_opening: tokAsBigTok(outOpeningIn),
              liquidity_inbound_pending: tokAsBigTok(outPendingIn),
              liquidity_outbound: tokAsBigTok(getAdjustedOutbound.outbound),
              liquidity_outbound_opening: tokAsBigTok(outOpeningOut),
              liquidity_outbound_pending: tokAsBigTok(outPendingOut),
            },
            {
              decreased_inbound_on: getAdjustedInbound.alias,
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
            },
          ],
        });

        return cbk();
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
