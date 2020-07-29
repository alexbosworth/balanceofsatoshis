const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const asyncWhilst = require('async/whilst');
const {getChannel} = require('ln-service');
const {getNode} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {getWalletVersion} = require('ln-service');
const {parsePaymentRequest} = require('ln-service');
const {payViaRoutes} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {subscribeToMultiPathProbe} = require('probing');

const {describeRoute} = require('./../display');
const {describeRoutingFailure} = require('./../display');
const probeDestination = require('./probe_destination');

const defaultFinalCltvDelta = 144;
const defaultMaxPaths = 5;
const flatten = arr => [].concat(...arr);
const pathTimeoutMs = 1000 * 60 * 5;
const uniq = arr => Array.from(new Set(arr));

/** Probe a destination, looking for multiple non-overlapping paths

  {
    [destination]: <Destination Public Key Hex String>
    [find_max]: <Find Maximum Payable On Probed Routes Below Tokens Number>
    [ignore]: [{
      from_public_key: <Avoid Node With Public Key Hex String>
    }]
    [in_through]: <Pay In Through Public Key Hex String>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    [max_paths]: <Maximum Probe Paths Number>
    [out_through]: <Out Through Peer With Public Key Hex String>
    [request]: <BOLT 11 Encoded Payment Request String>
    [timeout_minutes]: <Stop Searching For Routes After N Minutes Number>
    [tokens]: <Tokens Number>
  }

  @returns via cbk or Promise
  {
    [fee]: <Total Fee Tokens To Destination Number>
    [latency_ms]: <Latency Milliseconds Number>
    [relays]: [[<Relaying Public Key Hex String>]]
    [routes_maximum]: <Maximum Sendable Tokens on Paths Number>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.lnd) {
          return cbk([400, 'ExpectedLndApiObjectToProbe']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerObjectToStartProbe']);
        }

        if (!!args.request) {
          try {
            parsePaymentRequest({request: args.request});
          } catch (err) {
            return cbk([400, 'ExpectedValidPaymentRequestToProbe', {err}]);
          }
        }

        return cbk();
      },

      // Determine if this wallet is a legacy
      checkLegacy: ['validate', ({}, cbk) => {
        // Exit early, only check legacy when finding max routable
        if (!args.find_max) {
          return cbk();
        }

        return getWalletVersion({lnd: args.lnd}, err => {
          if (!!err) {
            return cbk([400, 'BackingLndDoesNotSupportMultiPathPayments']);
          }

          return cbk();
        });
      }],

      // Decode payment request
      decodeRequest: ['validate', ({}, cbk) => {
        // Exit early and only single probe when not finding maximum
        if (!args.find_max) {
          return cbk(null, {});
        }

        // Exit early when there is no request to decode
        if (!args.request) {
          return cbk(null, {});
        }

        const decoded = parsePaymentRequest({request: args.request});

        return cbk(null, {
          cltv_delta: decoded.cltv_delta,
          destination: decoded.destination,
          features: decoded.features,
          routes: decoded.routes,
        });
      }],

      // Get probe destination name
      getDestination: ['decodeRequest', ({decodeRequest}, cbk) => {
        const publicKey = decodeRequest.destination || args.destination;

        return getNode({
          is_omitting_channels: true,
          lnd: args.lnd,
          public_key: publicKey,
        },
        (err, res) => {
          if (!!err) {
            return cbk(null, publicKey);
          }

          return cbk(null, `${res.alias} ${publicKey}`.trim());
        });
      }],

      // Probe iteratively through multiple paths
      multiProbe: [
        'checkLegacy',
        'decodeRequest',
        'getDestination',
        ({decodeRequest, getDestination}, cbk) =>
      {
        // Exit early and only single probe when not finding maximum
        if (!args.find_max) {
          return cbk();
        }

        if (!!args.out_through) {
          return cbk([501, 'FindMaxThroughOutPeerNotSupported']);
        }

        args.logger.info({probing: getDestination});

        const sub = subscribeToMultiPathProbe({
          cltv_delta: decodeRequest.cltv_delta || defaultFinalCltvDelta,
          destination: decodeRequest.destination || args.destination,
          features: decodeRequest.features,
          ignore: args.ignore,
          incoming_peer: args.in_through,
          lnd: args.lnd,
          max_paths: args.max_paths,
          path_timeout_ms: pathTimeoutMs,
          routes: decodeRequest.routes,
        });

        sub.on('error', err => cbk(err));

        sub.on('evaluating', ({tokens}) => {
          return args.logger.info({evaluating: tokens});
        });

        sub.on('failure', () => {
          return cbk([503, 'FailedToFindAnyPathsToDestination']);
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
          return args.logger.info({paths});
        });

        return;
      }],

      // Probe just through a single path
      singleProbe: ['validate', ({}, cbk) => {
        // Exit early when not finding max
        if (!!args.find_max) {
          return cbk();
        }

        return probeDestination({
          destination: args.destination,
          ignore: args.ignore,
          in_through: args.in_through,
          lnd: args.lnd,
          logger: args.logger,
          out_through: args.out_through,
          request: args.request,
          tokens: args.tokens,
        },
        cbk);
      }],

      // Results of probe
      probe: [
        'multiProbe',
        'singleProbe',
        ({multiProbe, singleProbe}, cbk) =>
      {
        return cbk(null, multiProbe || singleProbe);
      }],
    },
    returnResult({reject, resolve, of: 'probe'}, cbk));
  });
};
