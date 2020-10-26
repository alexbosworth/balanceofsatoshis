const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const asyncWhilst = require('async/whilst');
const {getChannel} = require('ln-service');
const {getHeight} = require('ln-service');
const {getWalletVersion} = require('ln-service');
const {parsePaymentRequest} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const {channelsFromHints} = require('./../routing');
const {executeProbe} = require('./../network');
const {multiPathPayment} = require('./../network');
const {multiPathProbe} = require('./../network');

const defaultMaxPaths = 7;
const flatten = arr => [].concat(...arr);
const {isArray} = Array;
const legacyMax = 4294967;
const {max} = Math;
const minShardTokens = 1e5;
const normalMax = 16777215;
const sumOf = arr => arr.reduce((sum, n) => sum + n, Number());
const tokensAsMtokens = tokens => (BigInt(tokens) * BigInt(1e3)).toString();
const tooLargeError = 'PaymentTooLargeToFindRoute';
const uniq = arr => Array.from(new Set(arr));

/** Get routes for funding a swap

  {
    cltv_delta: <CLTV Delta Number>
    destination: <Destination Public Key Hex String>
    [features]: [{
      bit: <Feature Bit Number>
    }]
    ignore: [{
      from_public_key: <From Public Key Hex String>
      [to_public_key]: <To Public Key Hex String>
    }]
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    max_fee: <Maximum Fee Tokens Number>
    [max_paths]: <Maximum Paths To Use for Multi-Path Number>
    [out_through]: <Out Through Peer With Public Key Hex String>
    [outgoing_channel]: <Outgoing Standard Format Channel Id String>
    [payment]: <Payment Identifier Hex String>
    request: <Payment Request String>
    routes: [[{
      [base_fee_mtokens]: <Base Routing Fee In Millitokens String>
      [channel]: <Standard Format Channel Id String>
      [cltv_delta]: <CLTV Blocks Delta Number>
      [fee_rate]: <Fee Rate In Millitokens Per Million Number>
      public_key: <Forward Edge Public Key Hex String>
    }]]
    tokens: <Tokens To Send For Funding Number>
  }

  @returns via cbk or Promise
  {
    fee: <Total Fee Tokens Number>
    routes: [{
      fee: <Total Fee Tokens To Pay Number>
      fee_mtokens: <Total Fee Millitokens To Pay String>
      hops: [{
        channel: <Standard Format Channel Id String>
        channel_capacity: <Channel Capacity Tokens Number>
        fee: <Fee Number>
        fee_mtokens: <Fee Millitokens String>
        forward: <Forward Tokens Number>
        forward_mtokens: <Forward Millitokens String>
        [public_key]: <Public Key Hex String>
        timeout: <Timeout Block Height Number>
      }]
      [messages]: [{
        type: <Message Type Number String>
        value: <Message Raw Value Hex Encoded String>
      }]
      mtokens: <Total Millitokens To Pay String>
      [payment]: <Payment Identifier Hex String>
      timeout: <Expiration Block Height Number>
      tokens: <Total Tokens To Pay Number>
      [total_mtokens]: <Total Millitokens String>
    }]
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.cltv_delta) {
          return cbk([400, 'ExpectedCltvDeltaToGetRoutesForFunding']);
        }

        if (!args.destination) {
          return cbk([400, 'ExpectedDestinationToGetRoutesForFunding']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToGetRoutesForFunding']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToGetRoutesForFunding']);
        }

        if (!args.request) {
          return cbk([400, 'ExpectedFundingRequestToGetRoutesForFunding']);
        }

        if (!args.tokens) {
          return cbk([400, 'ExpectedTokensToGetRoutesForFunding']);
        }

        return cbk();
      },

      // Determine if the backing wallet is capable of multi-path
      getMultiSupport: ['validate', ({}, cbk) => {
        return getWalletVersion({lnd: args.lnd}, (err, res) => {
          return cbk(null, {is_multi_supported: !err});
        });
      }],

      // Get single path
      getSinglePath: ['validate', ({}, cbk) => {
        return executeProbe({
          cltv_delta: args.cltv_delta,
          destination: args.destination,
          features: args.features,
          ignore: args.ignore,
          lnd: args.lnd,
          logger: args.logger,
          max_fee: args.max_fee,
          outgoing_channel: args.outgoing_channel,
          payment: args.payment,
          routes: args.routes,
          tokens: args.tokens,
          total_mtokens: tokensAsMtokens(args.tokens),
        },
        (err, res) => {
          // Exit with no route when the amount is too big for a single path
          if (!!isArray(err) && err.includes(tooLargeError)) {
            return cbk(null, {is_size_limited: true});
          }

          if (!!err) {
            return cbk([503, 'UnexpectedErrorFindingRouteToFundSwap', {err}]);
          }

          return cbk(null, res);
        });
      }],

      // Get multiple limits
      getMultiLimits: [
        'getMultiSupport',
        'getSinglePath',
        ({getMultiSupport, getSinglePath}, cbk) =>
      {
        // Exit early when multi-path is not supported by the backing LND
        if (!getMultiSupport.is_multi_supported) {
          return cbk();
        }

        // Exit early when a specific peer is set to swap out through
        if (!!args.out_through) {
          return cbk();
        }

        // Exit early when the path limit is a single path
        if (args.max_paths === [getSinglePath].length) {
          return cbk();
        }

        let error;
        const probes = [];

        return asyncWhilst(
          cbk => {
            if ((args.max_paths || defaultMaxPaths) === probes.length) {
              return cbk(null, false);
            }

            return cbk(null, !error);
          },
          cbk => {
            return multiPathProbe({
              destination: args.destination,
              find_max: !getSinglePath.is_size_limited ? normalMax : legacyMax,
              ignore: args.ignore,
              in_through: args.in_through,
              lnd: args.lnd,
              logger: args.logger,
              probes: probes.filter(n => !!n),
              request: args.request,
              routes: args.routes,
              tokens: minShardTokens,
            },
            (err, res) => {
              if (!!err) {
                return cbk(err);
              }

              if (!!res.error) {
                error = res.error;
              } else {
                probes.push(res.probe);
              }

              return cbk();
            });
          },
          err => {
            if (!!err) {
              return cbk(err);
            }

            const complete = probes.filter(n => !!n);

            if (!complete.length) {
              return cbk(error);
            }

            const latencyMs = complete
              .map(n => n.latency_ms)
              .filter(n => !!n)
              .reduce((sum, n) => sum + n, Number());

            const max = complete
              .map(n => n.route_maximum)
              .reduce((sum, n) => sum + n, Number());

            return cbk(null, {
              latency_ms: latencyMs,
              probes: complete.map(probe => {
                return {
                  channels: probe.success,
                  liquidity: probe.route_maximum,
                  relays: probe.relays,
                };
              }),
              routes_max: max,
            });
          }
        );
      }],

      // Translate multiple limits into multiple routes
      getMultiPaths: ['getMultiLimits', async ({getMultiLimits}) => {
        if (!getMultiLimits || getMultiLimits.routes_max < args.tokens) {
          return;
        }

        const hintChans = channelsFromHints({request: args.request}).channels;
        const ids = flatten(getMultiLimits.probes.map(n => n.channels));

        const channels = await asyncMap(uniq(ids), async id => {
          // Exit early when channel is known from hints
          if (!!hintChans.find(n => n.id === id)) {
            return hintChans.find(n => n.id === id);
          }

          return await getChannel({id, lnd: args.lnd});
        });

        const {routes} = multiPathPayment({
          channels,
          cltv_delta: args.cltv_delta,
          destination: args.destination,
          height: (await getHeight({lnd: args.lnd})).current_block_height,
          max: getMultiLimits.routes_max,
          mtokens: tokensAsMtokens(args.tokens),
          payment: args.payment,
          probes: getMultiLimits.probes,
        });

        return routes;
      }],

      // Result of pathfinding
      result: [
        'getMultiPaths',
        'getSinglePath',
        ({getMultiPaths, getSinglePath}, cbk) =>
      {
        const paths = getMultiPaths || [getSinglePath.route].filter(n => !!n);

        if (!paths.length) {
          return cbk([503, 'PathfindingFailedToFullyFundSwapOffchain']);
        }

        const fee = sumOf(paths.map(n => n.fee));

        if (fee > args.max_fee) {
          return cbk([503, 'MaxFeeSettingExceeded', {needed_max_fee: fee}]);
        }

        return cbk(null, {fee: sumOf(paths.map(n => n.fee)), routes: paths});
      }],
    },
    returnResult({reject, resolve, of: 'result'}, cbk));
  });
};
