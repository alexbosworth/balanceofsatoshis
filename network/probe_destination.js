const asyncAuto = require('async/auto');
const {decodePaymentRequest} = require('ln-service');
const {getRoutes} = require('ln-service');
const {payViaRoutes} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {subscribeToProbe} = require('ln-service');

const {authenticatedLnd} = require('./../lnd');

const defaultTokens = 10;
const {isArray} = Array;
const {now} = Date;

/** Determine if a payment request can be paid by probing it

  {
    [is_real_payment]: <Pay the Request after Probing Bool> // default: false
    logger: <Winston Logger Object>
    [max_fee]: <Maximum Fee Tokens Number>
    [node]: <Node Name String>
    request: <Payment Request String>
  }

  @returns via cbk
  {
    [fee]: <Fee Tokens To Destination Number>
    [latency_ms]: <Latency Milliseconds Number>
    [success]: [<Standard Format Channel Id String>]
  }
*/
module.exports = (args, cbk) => {
  return asyncAuto({
    // Lnd
    getLnd: cbk => authenticatedLnd({node: args.node}, cbk),

    // Decode payment request
    decodeRequest: ['getLnd', ({getLnd}, cbk) => {
      return decodePaymentRequest({
        lnd: getLnd.lnd,
        request: args.request,
      },
      cbk);
    }],

    // Check that there is a potential path
    checkPath: ['decodeRequest', 'getLnd', ({decodeRequest, getLnd}, cbk) => {
      return getRoutes({
        destination: decodeRequest.destination,
        fee: args.max_fee,
        is_adjusted_for_past_failures: true,
        lnd: getLnd.lnd,
        timeout: decodeRequest.cltv_delta,
        tokens: decodeRequest.tokens || defaultTokens,
      },
      (err, res) => {
        if (!!err) {
          return cbk(err);
        }

        if (!res.routes.length) {
          return cbk([404, 'FailedToFindPathToDestination']);
        }

        return cbk();
      });
    }],

    // Probe towards destination
    probe: ['decodeRequest', 'getLnd', ({decodeRequest, getLnd}, cbk) => {
      const start = now();

      const attemptedPaths = [];
      let success;

      const sub = subscribeToProbe({
        cltv_delta: decodeRequest.cltv_delta,
        destination: decodeRequest.destination,
        lnd: getLnd.lnd,
        path_timeout_ms: 1000 * 30,
        routes: decodeRequest.routes,
        tokens: decodeRequest.tokens || defaultTokens,
      });

      sub.on('end', () => {
        const latencyMs = now() - start;

        if (!success) {
          return cbk(null, {attempted_paths: attemptedPaths.length});
        }

        return cbk(null, {latency_ms: latencyMs, route: success});
      });

      sub.on('error', err => args.logger.error(err));

      sub.on('routing_failure', failure => {
        args.logger.info({
          failure: `${failure.reason} at ${failure.public_key}`,
        });
      });

      sub.on('probe_success', ({route}) => success = route);

      sub.on('probing', ({route}) => {
        attemptedPaths.push(route);

        return args.logger.info({
          checking: route.hops.map(n => `${n.channel} ${n.public_key}`)
        });
      });

      return;
    }],

    // If there is a successful route, pay it
    pay: [
      'decodeRequest',
      'getLnd',
      'probe',
      ({decodeRequest, getLnd, probe}, cbk) =>
    {
      if (!args.is_real_payment) {
        return cbk();
      }

      if (!probe.route) {
        return cbk();
      }

      if (args.max_fee !== undefined && probe.route.fee > args.max_fee) {
        return cbk([400, 'MaxFeeTooLow', {required_fee: probe.route.fee}]);
      }

      return payViaRoutes({
        id: decodeRequest.id,
        lnd: getLnd.lnd,
        routes: [probe.route],
      },
      cbk);
    }],

    outcome: ['pay', 'probe', ({pay, probe}, cbk) => {
      if (!probe.route) {
        return cbk(null, {attempted_paths: probe.attempted_paths});
      }

      const {route} = probe;

      return cbk(null, {
        fee: !route ? undefined : route.fee,
        latency_ms: !route ? undefined : probe.latency_ms,
        paid: !pay ? undefined : pay.tokens,
        preimage: !pay ? undefined : pay.secret,
        success: !route ? undefined : route.hops.map(({channel}) => channel),
      });
    }],
  },
  returnResult({of: 'outcome'}, cbk));
};
