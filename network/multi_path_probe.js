const asyncAuto = require('async/auto');
const {getChannels} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const multiProbe = require('./multi_probe');
const probeDestination = require('./probe_destination');

const flatten = arr => [].concat(...arr);
const {isArray} = Array;

/** Execute a probe but with multi-path payments in mind

  {
    [destination]: <Destination Public Key Hex String>
    [ignore]: [{
      from_public_key: <Avoid Node With Public Key Hex String>
    }]
    [in_through]: <Pay In Through Public Key Hex String>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    [max_paths]: <Maximum Paths To Attempt Number>
    [out_through]: <Out Through Peer With Public Key Hex String>
    probes: [{
      [fee]: <Total Fee Tokens To Destination Number>
      [latency_ms]: <Latency Milliseconds Number>
      [routes_maximum]: <Maximum Sendable Tokens on Paths Number>
      [success]: [[<Standard Format Channel Id String>]]
    }]
    [request]: <BOLT 11 Encoded Payment Request String>
    [routes]: [[{
      [base_fee_mtokens]: <Base Routing Fee In Millitokens String>
      [channel]: <Standard Format Channel Id String>
      [cltv_delta]: <CLTV Blocks Delta Number>
      [fee_rate]: <Fee Rate In Millitokens Per Million Number>
      public_key: <Forward Edge Public Key Hex String>
    }]]
    [timeout_minutes]: <Stop Searching For Routes After N Minutes Number>
    [tokens]: <Tokens Number>
  }

  @returns via cbk or Promise
  {
    [error]: <Probe Error Object>
    [probe]: {
      [fee]: <Total Fee Tokens To Destination Number>
      [latency_ms]: <Latency Milliseconds Number>
      [relays]: [<Relaying Node Public Key Hex String]
      [routes_maximum]: <Maximum Sendable Tokens on Paths Number>
      [success]: [[<Standard Format Channel Id String>]]
    }
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.lnd) {
          return cbk([400, 'ExpectedDestinationToExecuteMultiProbe']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerMethodToExecuteMultiProbe']);
        }

        if (!isArray(args.probes)) {
          return cbk([400, 'ExpectedRecordOfProbesToExecuteMultiProbe']);
        }

        return cbk();
      },

      // Get the channels to figure out the local liquidity situation
      getChannels: ['validate', ({}, cbk) => {
        return getChannels({lnd: args.lnd}, cbk);
      }],

      // Get the node public key
      getKey: ['validate', ({}, cbk) => getWalletInfo({lnd: args.lnd}, cbk)],

      // Run probe with ignore list
      probe: ['getChannels', 'getKey', ({getChannels, getKey}, cbk) => {
        const multiProbeIgnores = multiProbe({
          channels: getChannels.channels,
          from: getKey.public_key,
          ignore: args.ignore,
          probes: args.probes.filter(n => !!n.relays),
          tokens: args.tokens,
        });

        const antiIgnores = flatten((args.routes || []).map(route => {
          return route.map(n => n.public_key).map((hop, i, hops) => {
            if (!i) {
              return {};
            }

            const nextHop = hops[i + [hop].length];
            const prevHop = hops[i - [hop].length];

            return {
              from_public_key: !!prevHop ? prevHop : getKey.public_key,
              to_public_key: !!nextHop ? nextHop : args.destination,
            };
          });
        }));

        const ignore = multiProbeIgnores.ignore.filter(ignore => {
          return !antiIgnores.find(anti => {
            const from = ignore.from_public_key;
            const to = ignore.to_public_key;

            return anti.from_public_key === from && anti.to_public_key === to;
          });
        });

        return probeDestination({
          ignore,
          destination: args.destination,
          find_max: args.find_max,
          in_through: args.in_through,
          lnd: args.lnd,
          logger: args.logger,
          out_through: args.out_through,
          request: args.request,
          timeout_minutes: args.timeout_minutes,
          tokens: args.tokens,
        },
        (error, probe) => {
          if (!!error) {
            return cbk(null, {error});
          }

          return cbk(null, {probe});
        });
      }],
    },
    returnResult({reject, resolve, of: 'probe'}, cbk));
  });
};
