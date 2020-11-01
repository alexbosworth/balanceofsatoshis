const asyncAuto = require('async/auto');
const {encode} = require('cbor');
const {genericSwapAuth} = require('goldengate');
const {genericSwapService} = require('goldengate');
const {getNetwork} = require('ln-sync');
const {getSwapMacaroon} = require('goldengate');
const {getSwapOutTerms} = require('goldengate');
const {lightningLabsSwapAuth} = require('goldengate');
const {lightningLabsSwapService} = require('goldengate');
const {paidMacaroon} = require('goldengate');
const {parsePaymentRequest} = require('invoices');
const {payViaPaymentRequest} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {swapUserId} = require('goldengate');

const decodeSwapApiKey = require('./decode_swap_api_key');

const bitcoinNetwork = 'btc';
const bitcoinTestnetNetwork = 'btctestnet';
const bufferFromBase64 = base64 => Buffer.from(base64, 'base64');
const bufferFromHex = hex => Buffer.from(hex, 'hex');
const connectError = 'FailedToConnectToService';
const encodeCbor = json => encode(json).toString('hex');
const httpMatch = /^https?:\/\//;
const {isArray} = Array;
const mainnetSocket = 'https://balanceofsatoshis.com:11011';
const maxServiceFee = 1337;
const maxRoutingFee = 100;
const testnetSocket = 'https://balanceofsatoshis.com:11010';

/** Get a paid swap service object

  {
    fetch: <Fetch Function>
    lnd: <Authenticated LND gRPC API Object>
    [socket]: <Custom Backing Service Socket String>
    [token]: <Prepaid Service Token CBOR Encoded String>
  }

  @returns via cbk or Promise
  {
    id: <Authenticated User Id string>
    metadata: <Authenticated Service Metadata Object>
    paid: <Paid Tokens Number>
    service: <Authenticated Paid Swap Service Object>
    token: <Authentication Token Hex String>
  }
*/
module.exports = ({fetch, lnd, socket, token}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!fetch) {
          return cbk([400, 'ExpectedFetchFunctionToGetPaidService']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndToGetPaidService']);
        }

        return cbk();
      },

      // Decode service token when present
      decodeToken: ['validate', ({}, cbk) => {
        // Exit early when there is no token to decode
        if (!token) {
          return cbk();
        }

        return decodeSwapApiKey({key: token}, cbk);
      }],

      // Get network
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd}, cbk)],

      // Determine which endpoint to use for the service
      endpoint: ['getNetwork', ({getNetwork}, cbk) => {
        // Exit early when the endpoint is directly specified
        if (!!socket) {
          return cbk(null, socket);
        }

        const {metadata} = lightningLabsSwapAuth({});
        const {network} = getNetwork;

        const {service} = lightningLabsSwapService({network});

        return getSwapOutTerms({metadata, service}, err => {
          // Exit early when the standard endpoint is working
          if (!isArray(err)) {
            return cbk();
          }

          const [, message] = err;

          // Exit early when the error is not a connection issue
          if (message !== connectError) {
            return cbk();
          }

          // Try to switch to a backup socket when the main socket fails
          switch (getNetwork.network) {
          case bitcoinNetwork:
            return cbk(null, mainnetSocket);

          case bitcoinTestnetNetwork:
            return cbk(null, testnetSocket);

          default:
            return cbk();
          }
        });

        return cbk();
      }],

      // Make a service object for the remote swap service
      remote: ['endpoint', 'getNetwork', ({endpoint, getNetwork}, cbk) => {
        // Exit early when using a generic service
        if (!!endpoint && httpMatch.test(endpoint)) {
          try {
            return cbk(null, genericSwapService({fetch, socket: endpoint}));
          } catch (err) {
            return cbk([500, 'UnexpectedErrorInitiatingSwapService', {err}]);
          }
        }

        try {
          return cbk(null, lightningLabsSwapService({
            network: getNetwork.network,
            socket: endpoint,
          }));
        } catch (err) {
          return cbk([500, 'UnexpectedErrorInitiatingSwapService', {err}]);
        }
      }],

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

      // Pay for the macaroon
      payForMacaroon: [
        'decodeToken',
        'getUnpaidMacaroon',
        ({decodeToken, getUnpaidMacaroon}, cbk) =>
      {
        // Exit early when there is already a paid service token
        if (!!decodeToken) {
          return cbk(null, {secret: decodeToken.preimage});
        }

        const {request} = getUnpaidMacaroon;

        // Validate the service token payment request
        try {
          const {tokens} = parsePaymentRequest({request});

          if (tokens > maxServiceFee) {
            return cbk([503, 'UnexpectedlyHighServiceFee', {fee: tokens}]);
          }
        } catch (err) {
          return cbk([503, 'FailedToParseServicePaymentRequest', {err}]);
        }

        // Pay the service token payment request to purchase the macaroon
        return payViaPaymentRequest({
          lnd,
          request,
          max_fee: maxRoutingFee,
        },
        cbk);
      }],

      // Create authentication metadata object
      metadata: [
        'decodeToken',
        'endpoint',
        'getUnpaidMacaroon',
        'payForMacaroon',
        ({decodeToken, endpoint, getUnpaidMacaroon, payForMacaroon}, cbk) =>
      {
        if (!decodeToken && !payForMacaroon.secret) {
          return cbk([400, 'FailedToPurchasePaidServiceToken']);
        }

        const {macaroon} = getUnpaidMacaroon;
        const preimage = payForMacaroon.secret;

        // Exit early when using a generic service
        if (!!endpoint && httpMatch.test(endpoint)) {
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
        const paid = payForMacaroon.tokens;
        const {service} = remote;

        const token = encodeCbor({
          macaroon: bufferFromBase64(getUnpaidMacaroon.macaroon),
          preimage: bufferFromHex(payForMacaroon.secret),
        });

        return cbk(null, {id, metadata, paid, service, token});
      }],
    },
    returnResult({reject, resolve, of: 'paidService'}, cbk));
  });
};
