const asyncAuto = require('async/auto');
const asyncify = require('async/asyncify');
const {genericSwapAuth} = require('goldengate');
const {genericSwapService} = require('goldengate');
const {getNetwork} = require('ln-sync');
const {getSwapMacaroon} = require('goldengate');
const {lightningLabsSwapAuth} = require('goldengate');
const {lightningLabsSwapService} = require('goldengate');
const {parsePaymentRequest} = require('ln-service');
const {payViaPaymentRequest} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {swapUserId} = require('goldengate');

const decodeSwapApiKey = require('./decode_swap_api_key');
const {encodeAsCbor} = require('./../encryption');

const bufferFromBase64 = base64 => Buffer.from(base64, 'base64');
const bufferFromHex = hex => Buffer.from(hex, 'hex');
const httpMatch = /^https?:\/\//;
const isLimit = n => Number.isSafeInteger(n) && n > 0;
const maxRoutingFee = 100;
const maxServiceFee = 1337;

/** Get a paid swap service object

  {
    fetch: <Fetch Function>
    lnd: <Authenticated LND gRPC API Object>
    [max_fee]: <Maximum Tokens to Pay for a Service Token Number>
    [socket]: <Custom Backing Service Socket String>
    [token]: <Prepaid Service Token CBOR Encoded String>
  }

  @returns via cbk or Promise
  {
    id: <Authenticated User Id string>
    macaroon: <Paid Macaroon Base64 String>
    metadata: <Authenticated Service Metadata Object>
    paid: <Paid Tokens Number>
    preimage: <Paid Macaroon Payment Preimage Hex String>
    service: <Authenticated Paid Swap Service Object>
    token: <Authentication Token Hex String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.fetch) {
          return cbk([400, 'ExpectedFetchFunctionToGetPaidService']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToGetPaidService']);
        }

        if (args.max_fee !== undefined && !isLimit(args.max_fee)) {
          return cbk([400, 'ExpectedMaxApiKeyFeeAboveZeroToGetPaidService']);
        }

        return cbk();
      },

      // Decode service token when present
      decodeToken: ['validate', ({}, cbk) => {
        // Exit early when there is no token to decode
        if (!args.token) {
          return cbk();
        }

        return decodeSwapApiKey({key: args.token}, cbk);
      }],

      // Get network
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd: args.lnd}, cbk)],

      // Make a service object for the remote swap service
      remote: ['getNetwork', asyncify(({getNetwork}) => {
        // Exit early when using a generic service
        if (!!args.socket && httpMatch.test(args.socket)) {
          try {
            return genericSwapService({
              fetch: args.fetch,
              socket: args.socket,
            });
          } catch (err) {
            throw [500, 'UnexpectedErrorInitiatingSwapService', {err}];
          }
        }

        try {
          return lightningLabsSwapService({
            network: getNetwork.network,
            socket: args.socket,
          });
        } catch (err) {
          throw [500, 'UnexpectedErrorInitiatingSwapService', {err}];
        }
      })],

      // Get an unpaid swap macaroon
      getUnpaidMacaroon: [
        'decodeToken',
        'remote',
        ({decodeToken, remote}, cbk) =>
      {
        // Exit early when there is already a service token macaroon
        if (!!decodeToken) {
          return cbk(null, {
            id: swapUserId({macaroon: decodeToken.macaroon}).id,
            macaroon: decodeToken.macaroon,
          });
        }

        return getSwapMacaroon({service: remote.service}, cbk);
      }],

      // Parse the service token payment request
      parseRequest: [
        'decodeToken',
        'getUnpaidMacaroon',
        asyncify(({decodeToken, getUnpaidMacaroon}) =>
      {
        // Exit early when there is already a paid service token
        if (!!decodeToken) {
          return;
        }

        const {request} = getUnpaidMacaroon;

        try {
          return parsePaymentRequest({request});
        } catch (err) {
          throw [503, 'FailedToParseServicePaymentRequest', {err}];
        }
      })],

      // Pay for the macaroon
      payForMacaroon: [
        'decodeToken',
        'getUnpaidMacaroon',
        'parseRequest',
        ({decodeToken, getUnpaidMacaroon, parseRequest}, cbk) =>
      {
        // Exit early when there is already a paid service token
        if (!!decodeToken) {
          return cbk(null, {secret: decodeToken.preimage});
        }

        const {request} = getUnpaidMacaroon;
        const {tokens} = parseRequest;

        const maxFee = args.max_fee || maxServiceFee;

        // Exit early when the service token costs too much
        if (tokens > maxFee) {
          return cbk([503, 'UnexpectedlyHighServiceFee', {fee: tokens}]);
        }

        // Pay the service token payment request to purchase the macaroon
        return payViaPaymentRequest({
          request,
          lnd: args.lnd,
          max_fee: maxRoutingFee,
        },
        cbk);
      }],

      // Create authentication metadata object
      metadata: [
        'decodeToken',
        'getUnpaidMacaroon',
        'payForMacaroon',
        ({decodeToken, getUnpaidMacaroon, payForMacaroon}, cbk) =>
      {
        if (!decodeToken && !payForMacaroon.secret) {
          return cbk([400, 'FailedToPurchasePaidServiceToken']);
        }

        const {macaroon} = getUnpaidMacaroon;
        const preimage = payForMacaroon.secret;

        // Exit early when using a generic service
        if (!!args.socket && httpMatch.test(args.socket)) {
          return cbk(null, genericSwapAuth({macaroon, preimage}).metadata);
        }

        return cbk(null, lightningLabsSwapAuth({macaroon, preimage}).metadata);
      }],

      // Final service method details
      paidService: [
        'getUnpaidMacaroon',
        'metadata',
        'payForMacaroon',
        'remote',
        ({getUnpaidMacaroon, metadata, payForMacaroon, remote}, cbk) =>
      {
        const {id} = getUnpaidMacaroon;
        const {macaroon} = getUnpaidMacaroon;
        const paid = payForMacaroon.tokens;
        const preimage = payForMacaroon.secret;
        const {service} = remote;

        const token = encodeAsCbor({
          value: {
            macaroon: bufferFromBase64(macaroon),
            preimage: bufferFromHex(preimage),
          },
        })
        .cbor;

        return cbk(null, {
          id,
          macaroon,
          metadata,
          paid,
          preimage,
          service,
          token,
        });
      }],
    },
    returnResult({reject, resolve, of: 'paidService'}, cbk));
  });
};
