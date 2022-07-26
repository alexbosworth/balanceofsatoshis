const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const asyncWhilst = require('async/whilst');
const {findKey} = require('ln-sync');
const {formatTokens} = require('ln-sync');
const {getChannel} = require('ln-service');
const {getChannels} = require('ln-service');
const {getIdentity} = require('ln-service');
const {getNode} = require('ln-service');
const {getSyntheticOutIgnores} = require('probing');
const {getWalletVersion} = require('ln-service');
const {parsePaymentRequest} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {subscribeToMultiPathProbe} = require('probing');

const {describeRoute} = require('./../display');
const {describeRoutingFailure} = require('./../display');
const {getIgnores} = require('./../routing');
const {getTags} = require('./../tags');
const {parseAmount} = require('./../display');
const probeDestination = require('./probe_destination');

const defaultFinalCltvDelta = 144;
const defaultMaxPaths = 5;
const flatten = arr => [].concat(...arr);
const {isArray} = Array;
const pathTimeoutMs = 1000 * 60 * 5;
const singlePath = 1;
const uniq = arr => Array.from(new Set(arr));
const unsupported = 501;

/** Probe a destination, looking for multiple non-overlapping paths

  {
    avoid: [<Avoid Forwarding Through String>]
    [destination]: <Destination Public Key Hex String>
    [find_max]: <Find Maximum Payable On Probed Routes Below Tokens Number>
    [fs]: {
      getFile: <Read File Contents Function> (path, cbk) => {}
    }
    [in_through]: <Pay In Through Public Key Hex String>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    [max_paths]: <Maximum Probe Paths Number>
    out: [<Out Through Peer With Public Key Hex String>]
    [request]: <BOLT 11 Encoded Payment Request String>
    [timeout_minutes]: <Stop Searching For Routes After N Minutes Number>
    [tokens]: <Tokens Amount String>
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
        if (!isArray(args.avoid)) {
          return cbk([400, 'ExpectedAvoidArrayToProbe']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndApiObjectToProbe']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerObjectToStartProbe']);
        }

        if (!isArray(args.out)) {
          return cbk([400, 'ExpectedArrayOfOutPeersToStartProbe']);
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

      // Decode payment request
      decodeRequest: ['validate', ({}, cbk) => {
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

      // Get channels for figuring out avoid flags
      getChannels: ['validate', ({}, cbk) => {
        // Exit early when there are no avoids
        if (!args.avoid.length) {
          return cbk();
        }

        return getChannels({lnd: args.lnd}, cbk);
      }],

      // Get the node public key
      getIdentity: ['validate', ({}, cbk) => {
        // Exit early when there are no avoids
        if (!args.avoid.length) {
          return cbk();
        }

        return getIdentity({lnd: args.lnd}, cbk);
      }],

      // Find public keys to pay out through
      getOuts: ['validate', ({}, cbk) => {
        return asyncMap(args.out, (query, cbk) => {
          return findKey({query, lnd: args.lnd}, cbk);
        },
        cbk);
      }],

      // Get tags for figuring out avoid flags
      getTags: ['validate', ({}, cbk) => {
        // Exit early when there are no avoids
        if (!args.avoid.length) {
          return cbk();
        }

        return getTags({fs: args.fs}, cbk);
      }],

      // Determine if this wallet is a legacy
      isLegacy: ['validate', ({}, cbk) => {
        return getWalletVersion({lnd: args.lnd}, err => {
          if (!!err && err.slice().shift === unsupported) {
            return cbk(null, true);
          }

          if (!!err) {
            return cbk(err);
          }

          return cbk(null, false);
        });
      }],

      // Parse amount to probe
      tokens: ['validate', ({}, cbk) => {
        // Exit early when no tokens are specified
        if (!args.tokens) {
          return cbk();
        }

        try {
          return cbk(null, parseAmount({amount: args.tokens}).tokens);
        } catch (err) {
          return cbk([400, err.message]);
        }
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
          in_through: args.in_through,
          lnd: args.lnd,
          logger: args.logger,
          public_key: getIdentity.public_key,
          tags: getTags.tags,
        },
        cbk);
      }],

      // Get synthetic ignores to approximate out
      getIgnores: [
        'getBaseIgnores',
        'getOuts',
        ({getBaseIgnores, getOuts}, cbk) =>
      {
        // Exit early when not doing a multi-path
        if (!args.find_max && args.max_paths === singlePath) {
          return cbk();
        }

        // Exit early when there is no outbound restriction
        if (!getOuts.length) {
          return cbk(null, {ignore: getBaseIgnores.ignore});
        }

        return getSyntheticOutIgnores({
          ignore: getBaseIgnores.ignore,
          lnd: args.lnd,
          out: getOuts.map(n => n.public_key),
        },
        cbk);
      }],

      // Probe just through a single path
      singleProbe: [
        'getBaseIgnores',
        'getOuts',
        'tokens',
        ({getBaseIgnores, getOuts, tokens}, cbk) =>
      {
        // Exit early when not finding max
        if (!!args.find_max || args.max_paths !== singlePath) {
          return cbk();
        }

        // Exit early when probing on a single path
        if (getOuts.length > singlePath) {
          return cbk([501, 'MultipleOutPeersNotSupportedWithSinglePath']);
        }

        const [outThrough] = getOuts.map(n => n.public_key);

        return probeDestination({
          tokens,
          destination: args.destination,
          fs: args.fs,
          ignore: getBaseIgnores.ignore,
          in_through: args.in_through,
          lnd: args.lnd,
          logger: args.logger,
          out_through: outThrough,
          request: args.request,
        },
        cbk);
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
        'decodeRequest',
        'getDestination',
        'getIgnores',
        'getOuts',
        'isLegacy',
        ({decodeRequest, getDestination, getIgnores, isLegacy}, cbk) =>
      {
        // Exit early when not doing a multi-path
        if (!args.find_max && args.max_paths === singlePath) {
          return cbk();
        }

        // Exit with error when the backing LND is below 0.10.0
        if (!!isLegacy) {
          return cbk([501, 'BackingLndDoesNotSupportMultiPathPayments']);
        }

        const paths = [];

        args.logger.info({probing: getDestination});

        const sub = subscribeToMultiPathProbe({
          cltv_delta: decodeRequest.cltv_delta || defaultFinalCltvDelta,
          destination: decodeRequest.destination || args.destination,
          features: decodeRequest.features,
          ignore: getIgnores.ignore,
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

        sub.on('path', path => {
          paths.push(path);

          const liquidity = paths.reduce((m, n) => m + n.liquidity, Number());

          // Exit early when there is only one path
          if (args.max_paths === singlePath) {
            return;
          }

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
          const numPaths = paths.filter(n => !!n).length;
          const target = !args.find_max ? decodeRequest.tokens : undefined;

          args.logger.info({
            target_amount: !!target ? formatTokens({tokens: target}) : target,
            total_liquidity: formatTokens({tokens: liquidity}).display,
            total_paths: args.max_paths !== singlePath ? numPaths : undefined,
          });

          return cbk();
        });

        return;
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
