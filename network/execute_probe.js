const asyncAuto = require('async/auto');
const asyncMapSeries = require('async/mapSeries');
const {getNode} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {subscribeToProbe} = require('ln-service');
const {subscribeToProbeForRoute} = require('ln-service');

const {describeConfidence} = require('./../routing');

const {now} = Date;
const pathTimeoutMs = 1000 * 60;

/** Execute a probe

  {
    cltv_delta: <Final Cltv Delta Number>
    destination: <Final Destination Public Key Hex String>
    [features]: [{
      bit: <Feature Bit Number>
    }]
    [ignore]: [{
      from_public_key: <Avoid Node With Public Key Hex String>
    }]
    [in_through]: <In Through Public Key Hex String>
    [is_strict_hints]: <Interpret Routes Strictly Ignoring Other Paths Bool>
    [is_strict_max_fee]: <Avoid Probing Too-High Fee Routes Bool>
    lnd: <Authenticated LND gRPC API Object>
    logger: <Winston Logger Object>
    [max_fee]: <Maximum Fee Tokens Number>
    [max_timeout_height]: <Maximum Timeout Height Number>
    [outgoing_channel]: <Outgoing Channel Id String>
    [routes]: [[{
      [base_fee_mtokens]: <Base Fee Millitokens String>
      [channel]: <Standard Format Channel Id String>
      [channel_capacity]: <Channel Capacity Tokens Number>
      [cltv_delta]: <Channel CLTV Delta Number>
      [fee_rate]: <Proportional Fee Rate Number>
      public_key: <Destination Public Key Hex String>
    }]]
    tokens: <Tokens To Probe Number>
  }

  @returns via cbk or Promise
  {
    [attempted_paths]: <Attempted Paths Count Number>
    [latency_ms]: <Time Until Success Milliseconds Number>
    [route]: {
      fee: <Total Fee Tokens To Pay Number>
      fee_mtokens: <Total Fee Millitokens To Pay String>
      hops: [{
        channel: <Standard Format Channel Id String>
        channel_capacity: <Channel Capacity Tokens Number>
        fee: <Fee Number>
        fee_mtokens: <Fee Millitokens String>
        forward: <Forward Tokens Number>
        forward_mtokens: <Forward Millitokens String>
        public_key: <Public Key Hex String>
        timeout: <Timeout Block Height Number>
      }]
      mtokens: <Total Millitokens To Pay String>
      timeout: <Expiration Block Height Number>
      tokens: <Total Tokens To Pay Number>
    }
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.cltv_delta) {
          return cbk([400, 'ExpectedFinalCltvDeltaToExecuteProbe']);
        }

        if (!args.destination) {
          return cbk([400, 'ExpectedDestinationToExecuteProbe']);
        }

        if (!!args.is_strict_hints && !args.routes) {
          return cbk([400, 'ExpectedRoutesWhenStrictHintsSpecified']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToExecuteProbe']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToExecuteProbe']);
        }

        if (!args.tokens) {
          return cbk([400, 'ExpectedTokensToExecuteProbe']);
        }

        return cbk();
      },

      // Probe
      probe: ['validate', ({}, cbk) => {
        const attemptedPaths = [];
        const {features} = args;
        const start = now();

        const method = !features ? subscribeToProbe : subscribeToProbeForRoute;

        const sub = method({
          cltv_delta: args.cltv_delta,
          destination: args.destination,
          features: args.features,
          ignore: args.ignore,
          incoming_peer: args.in_through,
          is_strict_hints: !!args.is_strict_hints,
          lnd: args.lnd,
          max_fee: !args.is_strict_max_fee ? undefined : args.max_fee,
          max_timeout_height: args.max_timeout_height,
          outgoing_channel: args.outgoing_channel,
          path_timeout_ms: pathTimeoutMs,
          routes: args.routes,
          tokens: args.tokens,
        });

        const finished = (err, res) => {
          sub.removeAllListeners();

          return cbk(err, res);
        };

        // Finish without success
        sub.once('end', () => {
          return finished(null, {attempted_paths: attemptedPaths.length});
        });

        // Finish with error
        sub.on('error', err => finished(err));

        // Log failures encountered while trying to find a route
        sub.on('routing_failure', async fail => {
          const at = `at ${fail.channel || fail.public_key}`;
          const source = fail.route.hops[fail.index - 1];

          let fromName = !source ? null : source.public_key;

          try {
            const node = await getNode({
              is_omitting_channels: true,
              lnd: args.lnd,
              public_key: source.public_key,
            });

            fromName = node.alias;
          } catch (err) {}

          const from = !source ? '' : `from ${fromName}`;

          return args.logger.info({failure: `${fail.reason} ${at} ${from}`});
        });

        // Finish with successful probe
        sub.on('probe_success', ({route}) => {
          const {fee} = route;

          // Finish with error when there is a fee limit exceeded
          if (!!args.max_fee && fee > args.max_fee) {
            return finished([400, 'MaxFeeLimitTooLow', {needed_fee: fee}]);
          }

          return finished(null, {route, latency_ms: now() - start});
        });

        // Log probing attempts
        sub.on('probing', ({route}) => {
          attemptedPaths.push(route);

          return asyncMapSeries(route.hops, (hop, cbk) => {
            return getNode({
              is_omitting_channels: true,
              lnd: args.lnd,
              public_key: hop.public_key,
            },
            (err, node) => {
              // Ignore errors, not all nodes may be in the graph
              const alias = (!!err || !node || !node.alias) ? '' : node.alias;

              const towards = `${alias} ${hop.public_key}`;

              return cbk(null, `${hop.fee} ${hop.channel} ${towards}`);
            });
          },
          (err, evaluating) => {
            if (!!err) {
              return args.logger.error(err);
            }

            const {confidence} = route;

            const {description} = describeConfidence({confidence});

            return args.logger.info({
              evaluating,
              confidence: description || undefined,
              potential_fee: route.fee,
            });
          });
        });

        return;
      }],
    },
    returnResult({reject, resolve, of: 'probe'}, cbk));
  });
};
