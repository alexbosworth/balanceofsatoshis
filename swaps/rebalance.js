const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const asyncMapSeries = require('async/mapSeries');
const {createInvoice} = require('ln-service');
const {getChannel} = require('ln-service');
const {getChannels} = require('ln-service');
const {getNode} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {payViaRoutes} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {routeFromChannels} = require('ln-service');

const {probeDestination} = require('./../network');
const {sortBy} = require('./../arrays');

const {ceil} = Math;
const cltvDelta = 50;
const defaultMaxFee = 1337;
const defaultMaxFeeRate = 250;
const highInbound = 4500000;
const {max} = Math;
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
const tokAsBigTok = tokens => (tokens / 1e8).toFixed(8);
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
    [node]: <Node Name String>
    [out_through]: <Pay Out Through Peer String>
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToRebalance'])
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
        if (!args.in_through || args.in_through.length === pubKeyHexLength) {
          return cbk(null, args.in_through);
        }

        const {channels} = getInitialLiquidity;
        const query = args.in_through;

        const keys = uniq(channels.map(n => n.partner_public_key));

        return asyncMap(keys, (key, cbk) => {
          return getNode({lnd, public_key: key}, (err, node) => {
            // Suppress errors on matching lookup
            if (!!err) {
              return cbk();
            }

            // Exit early when the alias doesn't match the query
            if (!node.alias.toLowerCase().includes(query.toLowerCase())) {
              return cbk();
            }

            return cbk(null, {alias: node.alias, public_key: key});
          });
        },
        (err, res) => {
          const matching = !res ? null : res.filter(n => !!n);

          if (!!err || !matching.length) {
            return cbk([400, 'FailedToFindAliasMatchForInboundPeer']);
          }

          const [match, secondMatch] = matching.filter(n => !!n);

          if (!!secondMatch) {
            return cbk([400, 'AmbiguousInboundPeerSpecified', {matching}]);
          }

          return cbk(null, match.public_key);
        });
      }],

      // Find outbound peer key if a name is specified
      findOutKey: [
        'getInitialLiquidity',
        'lnd',
        ({getInitialLiquidity, lnd}, cbk) =>
      {
        if (!args.out_through || args.out_through.length === pubKeyHexLength) {
          return cbk(null, args.out_through);
        }

        const {channels} = getInitialLiquidity;
        const query = args.out_through;

        const keys = uniq(channels.map(n => n.partner_public_key));

        return asyncMap(keys, (key, cbk) => {
          return getNode({lnd, public_key: key}, (err, node) => {
            // Suppress errors on lookup
            if (!!err) {
              return cbk();
            }

            // Exit early when the node doesn't match the query
            if (!node.alias.toLowerCase().includes(query.toLowerCase())) {
              return cbk();
            }

            return cbk(null, {alias: node.alias, public_key: key});
          });
        },
        (err, res) => {
          const matching = res.filter(n => !!n);

          if (!!err || !matching.length) {
            return cbk([400, 'FailedToFindAliasMatchForOutboundPeer']);
          }

          const [match, secondMatch] = matching;

          if (!!secondMatch) {
            return cbk([400, 'AmbiguousOutboundPeerSpecified', {matching}]);
          }

          return cbk(null, match.public_key);
        });
      }],

      // Get outbound node details
      getOutbound: [
        'findOutKey',
        'getInitialLiquidity',
        'lnd',
        ({findOutKey, getInitialLiquidity, lnd}, cbk) =>
      {
        const ignore = args.avoid || [];

        const active = getInitialLiquidity.channels
          .filter(n => !!n.is_active)
          .filter(n => ignore.indexOf(n.partner_public_key) === notFoundIndex);

        const channels = active
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
        'lnd',
        ({findInKey, getFees, getInitialLiquidity, getOutbound, lnd}, cbk) =>
      {
        const hasInThrough = !!args.in_through;
        const ignore = args.avoid || [];

        const activeChannels = getInitialLiquidity.channels
          .filter(n => !!n.is_active)
          .filter(n => n.partner_public_key !== getOutbound.public_key)
          .filter(n => ignore.indexOf(n.partner_public_key) === notFoundIndex);

        const channels = activeChannels
          .filter(n => hasInThrough || n.remote_balance > minInboundBalance)
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

        const array = channels.filter(chan => {
          const peerKey = chan.partner_public_key;

          const policies = getFees.channels.map(({policies}) => {
            return policies.find(n => n.public_key === peerKey);
          });

          const feeRates = policies.filter(n => !!n).map(n => n.fee_rate);

          const feeRate = max(...feeRates);

          return feeRate < (args.max_fee_rate || defaultMaxFeeRate);
        });

        if (!array.length) {
          return cbk([400, 'NoLowFeeInboundChannelToReceiveRebalance']);
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

      // Find a route to the destination
      findRoute: [
        'getInbound',
        'getOutbound',
        'getPublicKey',
        ({getInbound, getOutbound, getPublicKey}, cbk) =>
      {
        const avoid = (args.avoid || []).map(n => ({from_public_key: n}));

        return probeDestination({
          destination: getPublicKey.public_key,
          find_max: 4294967,
          ignore: [{from_public_key: getPublicKey.public_key}].concat(avoid),
          in_through: getInbound.public_key,
          logger: args.logger,
          lnd: args.lnd,
          max_fee: Math.floor(5e6 * 0.0025),
          node: args.node,
          out_through: getOutbound.public_key,
          tokens: 10000,
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
          cltv_delta: cltvDelta,
          description: 'Rebalance',
          tokens: min(maxRebalanceTokens, findRoute.route_maximum),
        },
        cbk);
      }],

      // Get the current height
      getHeight: ['channels', 'lnd', ({lnd}, cbk) => {
        return getWalletInfo({lnd}, cbk);
      }],

      // Calculate route for rebalance
      routes: [
        'channels',
        'getHeight',
        'getPublicKey',
        'invoice',
        ({channels, getHeight, getPublicKey, invoice}, cbk) =>
      {
        try {
          const {route} = routeFromChannels({
            channels,
            cltv_delta: cltvDelta,
            destination: getPublicKey.public_key,
            height: getHeight.current_block_height,
            mtokens: (BigInt(invoice.tokens) * mtokensPerToken).toString(),
          });

          const maxFee = args.max_fee || defaultMaxFee;
          const maxFeeRate = args.max_fee_rate || defaultMaxFeeRate;

          // Exit early when a max fee is specified and exceeded
          if (!!maxFee && route.fee > maxFee) {
            return cbk([
              400,
              'RebalanceFeeTooHigh',
              {needed_max_fee: route.fee},
            ]);
          }

          const feeRate = ceil(route.fee / route.tokens * rateDivisor);

          // Exit early when the max fee rate is specified and exceeded
          if (!!maxFeeRate && feeRate > maxFeeRate) {
            return cbk([
              400,
              'RebalanceFeeTooHigh',
              {needed_max_fee_rate: feeRate},
            ]);
          }

          return cbk(null, [route]);
        } catch (err) {
          return cbk([500, 'FailedToConstructRebalanceRoute', {err}]);
        }
      }],

      // Execute the rebalance
      pay: ['invoice', 'lnd', 'routes', ({invoice, lnd, routes}, cbk) => {
        return payViaRoutes({lnd, routes, id: invoice.id}, cbk);
      }],

      // Final rebalancing
      rebalance: [
        'getInbound',
        'getInitialLiquidity',
        'getOutbound',
        'pay',
        ({getInbound, getInitialLiquidity, getOutbound, pay}, cbk) =>
      {
        const inPeerInbound = getInitialLiquidity.channels
          .filter(n => n.partner_public_key === getInbound.public_key)
          .filter(n => !!n.is_active)
          .reduce((sum, n) => sum + n.remote_balance, minTokens);

        const inPeerOutbound = getInitialLiquidity.channels
          .filter(n => n.partner_public_key === getInbound.public_key)
          .filter(n => !!n.is_active)
          .reduce((sum, n) => sum + n.local_balance, minTokens);

        const outPeerInbound = getInitialLiquidity.channels
          .filter(n => n.partner_public_key === getOutbound.public_key)
          .filter(n => !!n.is_active)
          .reduce((sum, n) => sum + n.remote_balance, minTokens);

        const outPeerOutbound = getInitialLiquidity.channels
          .filter(n => n.partner_public_key === getOutbound.public_key)
          .filter(n => !!n.is_active)
          .reduce((sum, n) => sum + n.local_balance, minTokens);

        args.logger.info({
          rebalance: [
            {
              increased_inbound_on: getOutbound.alias,
              liquidity_inbound: tokAsBigTok(outPeerInbound + pay.tokens),
              liquidity_outbound: tokAsBigTok(outPeerOutbound - pay.tokens),
            },
            {
              decreased_inbound_on: getInbound.alias,
              liquidity_inbound: tokAsBigTok(inPeerInbound - pay.tokens),
              liquidity_outbound: tokAsBigTok(inPeerOutbound + pay.tokens),
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
