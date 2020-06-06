const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const asyncWhilst = require('async/whilst');
const {getChannel} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {getWalletVersion} = require('ln-service');
const {payViaRoutes} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const multiPathProbe = require('./multi_path_probe');
const probeDestination = require('./probe_destination');

const defaultMaxPaths = 5;
const flatten = arr => [].concat(...arr);
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

      // Probe iteratively through multiple paths
      multiProbe: ['checkLegacy', ({}, cbk) => {
        // Exit early and only single probe when not finding maximum
        if (!args.find_max) {
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
              find_max: args.find_max,
              ignore: args.ignore,
              in_through: args.in_through,
              lnd: args.lnd,
              logger: args.logger,
              out_through: args.out_through,
              probes: probes.filter(n => !!n),
              request: args.request,
              timeout_minutes: args.timeout_minutes,
              tokens: args.tokens,
            },
            (err, res) => {
              if (!!err) {
                return cbk(err);
              }

              if (!!res.error) {
                error = res.error;
              } else {
                probes.push(res.probe || null);
              }

              return cbk();
            });
          },
          err => {
            if (!!err) {
              return cbk(err);
            }

            const completed = probes.filter(n => !!n);

            if (!completed.length) {
              return cbk(error);
            }

            const latencyMs = completed
              .map(n => n.latency_ms)
              .reduce((sum, n) => sum + n, Number());

            const max = completed
              .map(n => n.route_maximum)
              .reduce((sum, n) => sum + n, Number());

            return cbk(null, {
              latency_ms: latencyMs,
              probes: completed.map(probe => {
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
