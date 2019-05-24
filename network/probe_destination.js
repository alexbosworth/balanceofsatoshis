const asyncAuto = require('async/auto');
const {authenticatedLndGrpc} = require('ln-service');
const {decodePaymentRequest} = require('ln-service');
const {getRoutes} = require('ln-service');
const {probe} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const {lndCredentials} = require('./../lnd');

const defaultTokens = 10;
const {now} = Date;

/** Determine if a payment request can be paid by probing it

  {
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
module.exports = ({node, request}, cbk) => {
  return asyncAuto({
    // Credentials
    credentials: cbk => lndCredentials({node}, cbk),

    // Lnd
    lnd: ['credentials', ({credentials}, cbk) => {
      return cbk(null, authenticatedLndGrpc({
        cert: credentials.cert,
        macaroon: credentials.macaroon,
        socket: credentials.socket,
      }).lnd);
    }],

    // Decode payment request
    decodeRequest: ['lnd', ({lnd}, cbk) => {
      return decodePaymentRequest({lnd, request}, cbk);
    }],

    // Find routes to destination
    findRoutes: ['decodeRequest', 'lnd', ({decodeRequest, lnd}, cbk) => {
      return getRoutes({
        lnd,
        destination: decodeRequest.destination,
        tokens: decodeRequest.tokens || defaultTokens,
      },
      cbk);
    }],

    // Start timer
    start: ['findRoutes', ({}, cbk) => cbk(null, now())],

    // Probe towards destination
    checkRequest: [
      'decodeRequest',
      'lnd',
      'findRoutes',
      ({decodeRequest, findRoutes, lnd}, cbk) =>
    {
      const {routes} = findRoutes;

      return probe({lnd, routes, tokens: decodeRequest.tokens}, cbk);
    }],

    // Payable?
    payable: ['checkRequest', 'start', ({checkRequest, start}, cbk) => {
      const {successes} = checkRequest;

      if (!Array.isArray(successes)) {
        return cbk(null, {});
      }

      const latencyMs = now() - start;
      const {route} = checkRequest;

      const failed = checkRequest.temporary_failures.map(n => n.channel);

      if (!route) {
        return cbk(null, {failure: {failed_forwards: failed}});
      }

      const {fee} = route;
      const hops = route.hops.map(({channel}) => channel);

      return cbk(null, {success: {fee, hops, latency_ms: latencyMs}});
    }],
  },
  returnResult({of: 'payable'}, cbk));
};
