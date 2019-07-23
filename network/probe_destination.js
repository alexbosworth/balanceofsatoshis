const asyncAuto = require('async/auto');
const {decodePaymentRequest} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {subscribeToProbe} = require('ln-service');

const {authenticatedLnd} = require('./../lnd');

const defaultTokens = 10;
const {isArray} = Array;
const {now} = Date;
const maxProbability = 1e6;

/** Determine if a payment request can be paid by probing it

  {
    logger: <Winston Logger Object>
    [node]: <Node Name String>
    request: <Payment Request String>
  }

  @returns via cbk
  {
    [success]: {
      fee: <Fee Tokens To Destination Number>
    }
  }
*/
module.exports = ({logger, node, request}, cbk) => {
  return asyncAuto({
    // Lnd
    getLnd: cbk => authenticatedLnd({node}, cbk),

    // Decode payment request
    decodeRequest: ['getLnd', ({getLnd}, cbk) => {
      return decodePaymentRequest({request, lnd: getLnd.lnd}, cbk);
    }],

    // Probe towards destination
    probe: ['decodeRequest', 'getLnd', ({decodeRequest, getLnd}, cbk) => {
      const start = now();

      const attemptedPaths = [];
      let success;

      const sub = subscribeToProbe({
        cltv_delta: decodeRequest.cltv_delta,
        destination: decodeRequest.destination,
        ignore_probability_below: maxProbability,
        lnd: getLnd.lnd,
        path_timeout_ms: 1000 * 60 * 3,
        routes: decodeRequest.routes,
        tokens: decodeRequest.tokens || defaultTokens,
      });

      sub.on('end', () => {
        const latencyMs = now() - start;

        if (!success) {
          return cbk(null, {attempted_paths: attemptedPaths.length});
        }

        return cbk(null, {
          fee: success.fee,
          latency_ms: latencyMs,
          success: success.hops.map(n => n.channel),
        });
      });

      sub.on('error', err => logger.error(err));

      sub.on('routing_failure', failure => {
        logger.info({
          failure: failure.reason,
          hops: failure.route.hops.map(n => n.channel),
        });
      });

      sub.on('probe_success', ({route}) => success = route);

      sub.on('probing', ({route}) => {
        attemptedPaths.push(route);

        return logger.info({attempting: route.hops.map(n => n.channel)});
      });

      return;
    }],
  },
  returnResult({of: 'probe'}, cbk));
};
