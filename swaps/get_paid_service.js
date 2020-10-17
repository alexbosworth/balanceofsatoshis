const asyncAuto = require('async/auto');
const {encode} = require('cbor');
const {genericSwapService} = require('goldengate');
const {getNetwork} = require('ln-sync');
const {getSwapMacaroon} = require('goldengate');
const {lightningLabsSwapService} = require('goldengate');
const {paidMacaroon} = require('goldengate');
const {payViaPaymentRequest} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {swapUserId} = require('goldengate');

const decodeSwapApiKey = require('./decode_swap_api_key');

const bitcoinTestnetNetwork = 'btctestnet';
const bufferFromBase64 = base64 => Buffer.from(base64, 'base64');
const bufferFromHex = hex => Buffer.from(hex, 'hex');
const encodeCbor = json => encode(json).toString('hex');
const httpMatch = /^https?:\/\//;
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
    macaroon: <Authenticated Service Macaroon Base64 String>
    paid: <Paid Tokens Number>
    preimage: <Authenticated Preimage Hex String>
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

      // Make a service object for the remote swap service
      remote: ['getNetwork', ({getNetwork}, cbk) => {
        // Exit early when using a generic service
        if (!!socket && httpMatch.test(socket)) {
          try {
            return cbk(null, genericSwapService({fetch, socket}));
          } catch (err) {
            return cbk([500, 'UnexpectedErrorInitiatingSwapService', {err}]);
          }
        }

        const {network} = getNetwork;

        // Exit early and use a generic service on testnet
        if (!socket && network === bitcoinTestnetNetwork) {
          return cbk(null, genericSwapService({fetch, socket: testnetSocket}));
        }

        try {
          return cbk(null, lightningLabsSwapService({network, socket}));
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

        // Purchase the macaroon
        return payViaPaymentRequest({
          lnd,
          max_fee: maxRoutingFee,
          request: getUnpaidMacaroon.request,
        },
        cbk);
      }],

      // Final service method details
      paidService: [
        'decodeToken',
        'getUnpaidMacaroon',
        'payForMacaroon',
        'remote',
        ({decodeToken, getUnpaidMacaroon, payForMacaroon, remote}, cbk) =>
      {
        const {id} = getUnpaidMacaroon;
        const {macaroon} = getUnpaidMacaroon;
        const paid = payForMacaroon.tokens;
        const preimage = payForMacaroon.secret;
        const {service} = remote;

        if (!decodeToken && !preimage) {
          return cbk([400, 'FailedToPurchasePaidServiceTokens']);
        }

        const token = encodeCbor({
          macaroon: bufferFromBase64(macaroon),
          preimage: bufferFromHex(preimage),
        });

        return cbk(null, {id, macaroon, paid, preimage, service, token});
      }],
    },
    returnResult({reject, resolve, of: 'paidService'}, cbk));
  });
};
