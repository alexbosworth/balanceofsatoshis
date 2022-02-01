const asyncAuto = require('async/auto');
const asyncMapSeries = require('async/mapSeries');
const {getNode} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {subscribeToProbe} = require('ln-service');
const {subscribeToProbeForRoute} = require('ln-service');

const {describeConfidence} = require('./../display');
const {describeRoute} = require('./../display');

const {ceil} = Math;
const {now} = Date;
const minutesAsMs = minutes => 1000 * 60 * minutes;
const pathTimeoutMs = 1000 * 60 * 5;
const rateDivisor = 1e6;
const tokensAsMillitokens = tok => (BigInt(tok) * BigInt(1e3)).toString();

/** Execute a probe

  {
    cltv_delta: <Final Cltv Delta Number>
    destination: <Final Destination Public Key Hex String>
    [features]: [{
      bit: <Feature Bit Number>
    }]
    [ignore]: [{
      from_public_key: <Avoid Node With Public Key Hex String>
      [to_public_key]: <Avoid Routing To Node With Public Key Hex String>
    }]
    [in_through]: <In Through Public Key Hex String>
    [is_strict_max_fee]: <Avoid Probing Too-High Fee Routes Bool>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    [max_fee]: <Maximum Fee Tokens Number>
    [max_fee_rate]: <Max Fee Rate Tokens Per Million Number>
    [max_timeout_height]: <Maximum Timeout Height Number>
    [messages]: [{
      type: <Message To Final Destination Type Number String>
      value: <Message To Final Destination Raw Value Hex Encoded String>
    }]
    [outgoing_channel]: <Outgoing Channel Id String>
    [payment]: <Payment Identifier Hex String>
    [routes]: [[{
      [base_fee_mtokens]: <Base Fee Millitokens String>
      [channel]: <Standard Format Channel Id String>
      [channel_capacity]: <Channel Capacity Tokens Number>
      [cltv_delta]: <Channel CLTV Delta Number>
      [fee_rate]: <Proportional Fee Rate Number>
      public_key: <Destination Public Key Hex String>
    }]]
    [tagged]: [{
      icons: [<Icon String>]
      public_key: <Public Key Hex String>
    }]
    [timeout_minutes]: <Stop Searching For Route After N Minutes Number>
    tokens: <Tokens To Probe Number>
    [total_mtokens]: <Total Millitokens String>
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

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToExecuteProbe']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToExecuteProbe']);
        }

        if (!args.mtokens && !args.tokens) {
          return cbk([400, 'ExpectedTokensToExecuteProbe']);
        }

        return cbk();
      },

      // Determine total mtokens
      mtokens: ['validate', ({}, cbk) => {
        if (!!args.mtokens || !args.payment || !args.tokens) {
          return cbk(null, args.mtokens);
        }

        return cbk(null, tokensAsMillitokens(args.tokens));
      }],

      // Probe
      probe: ['mtokens', ({mtokens}, cbk) => {
        const attemptedPaths = [];
        const {features} = args;
        const start = now();

        const timeoutMinutes = minutesAsMs((args.timeout_minutes || Number()));

        const sub = subscribeToProbeForRoute({
          mtokens,
          cltv_delta: args.cltv_delta,
          destination: args.destination,
          features: args.features,
          ignore: args.ignore,
          incoming_peer: args.in_through,
          lnd: args.lnd,
          max_fee: !args.is_strict_max_fee ? undefined : args.max_fee,
          max_timeout_height: args.max_timeout_height,
          messages: args.messages,
          outgoing_channel: args.outgoing_channel,
          path_timeout_ms: pathTimeoutMs,
          payment: args.payment,
          probe_timeout_ms: timeoutMinutes || undefined,
          routes: args.routes,
          tokens: args.tokens,
          total_mtokens: !!args.payment ? mtokens : undefined,
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
          const feeRate = ceil(route.fee / route.tokens * rateDivisor);

          // Finish with error when there is a fee limit exceeded
          if (!!args.max_fee && fee > args.max_fee) {
            return finished([400, 'MaxFeeLimitTooLow', {needed_fee: fee}]);
          }
          // Finish with error when there is a fee rate limit exceeded
          if(args.max_fee_rate !== undefined && feeRate > args.max_fee_rate) {
            return finished([400, 'MaxFeeRateTooLow', {needed_fee_rate: feeRate}]);
          }

          return finished(null, {route, latency_ms: now() - start});
        });

        // Log probing attempts
        sub.on('probing', async ({route}) => {
          attemptedPaths.push(route);

          const {description} = await describeRoute({
            route,
            lnd: args.lnd,
            tagged: args.tagged || undefined,
          });

          return args.logger.info({evaluating: description});
        });

        return;
      }],
    },
    returnResult({reject, resolve, of: 'probe'}, cbk));
  });
};
