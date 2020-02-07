const asyncAuto = require('async/auto');
const {encode} = require('cbor');
const {getSwapMacaroon} = require('goldengate');
const {lightningLabsSwapService} = require('goldengate');
const {paidMacaroon} = require('goldengate');
const {returnResult} = require('asyncjs-util');
const {swapUserId} = require('goldengate');

const decodeSwapApiKey = require('./decode_swap_api_key');
const {getNetwork} = require('./../network');
const {probeDestination} = require('./../network');

const encodeCbor = json => encode(json).toString('hex');
const maxRoutingFee = 100;

/** Get a paid swap service object

  {
    lnd: <Authenticated LND gRPC API Object>
    logger: <Winston Logger Object>
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
module.exports = ({lnd, logger, token}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedLndToGetPaidService']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedLoggerToGetPaidService']);
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

      // Get an unpaid swap macaroon
      getUnpaidMacaroon: [
        'decodeToken',
        'getNetwork',
        ({decodeToken, getNetwork}, cbk) =>
      {
        // Exit early when there is already a service token macaroon
        if (!!decodeToken) {
          return cbk(null, {
            id: swapUserId({macaroon: decodeToken.macaroon}).id,
            macaroon: decodeToken.macaroon,
          });
        }

        const {network} = getNetwork;

        try {
          lightningLabsSwapService({network});
        } catch (err) {
          return cbk([400, 'UnexpectedErrorInitiatingSwapService', {err}]);
        }

        const {service} = lightningLabsSwapService({network});

        return getSwapMacaroon({service}, cbk);
      }],

      // Pay for the macaroon
      payForMacaroon: [
        'decodeToken',
        'getUnpaidMacaroon',
        ({decodeToken, getUnpaidMacaroon}, cbk) =>
      {
        // Exit early when there is already a paid service token
        if (!!decodeToken) {
          return cbk(null, {preimage: decodeToken.preimage});
        }

        // Purchase the macaroon
        return probeDestination({
          lnd,
          logger,
          is_real_payment: true,
          max_fee: maxRoutingFee,
          request: getUnpaidMacaroon.request,
        },
        cbk);
      }],

      // Get the paid service object
      service: [
        'getNetwork',
        'getUnpaidMacaroon',
        'payForMacaroon',
        ({getNetwork, getUnpaidMacaroon, payForMacaroon}, cbk) =>
      {
        const {id} = getUnpaidMacaroon;
        const {macaroon} = getUnpaidMacaroon;
        const {network} = getNetwork;
        const {paid} = payForMacaroon;
        const {preimage} = payForMacaroon;

        try {
          lightningLabsSwapService({macaroon, network});
        } catch (err) {
          return cbk([400, 'FailedToFindSupportedSwapService', {err}]);
        }

        const {service} = lightningLabsSwapService({macaroon, network});

        const token = encodeCbor({
          macaroon: Buffer.from(macaroon, 'base64'),
          preimage: Buffer.from(preimage, 'hex'),
        });

        return cbk(null, {id, macaroon, paid, preimage, service, token});
      }],
    },
    returnResult({reject, resolve, of: 'service'}, cbk));
  });
};
