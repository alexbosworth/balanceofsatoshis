const asyncAuto = require('async/auto');
const {decodeFirst} = require('cbor');
const {encode} = require('cbor');
const {getSwapMacaroon} = require('goldengate');
const {lightningLabsSwapService} = require('goldengate');
const {paidMacaroon} = require('goldengate');
const {returnResult} = require('asyncjs-util');

const {probeDestination} = require('./../network');

const encodeCbor = json => encode(json).toString('hex');
const maxRoutingFee = 100;

/** Get a paid swap service object

  {
    lnd: <Authenticated LND gRPC API Object>
    logger: <Winston Logger Object>
    network: <Network Name String>
    [token]: <Prepaid Service Token CBOR Encoded String>
  }

  @returns via cbk or Promise
  {
    macaroon: <Authenticated Service Macaroon Base64 String>
    paid: <Paid Tokens Number>
    preimage: <Authenticated Preimage Hex String>
    service: <Authenticated Paid Swap Service Object>
    token: <Authentication Token Hex String>
  }
*/
module.exports = ({lnd, logger, network, token}, cbk) => {
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

        if (!network) {
          return cbk([400, 'ExpectedNetworkToGetPaidService']);
        }

        return cbk();
      },

      // Decode service token when present
      decodeToken: ['validate', ({}, cbk) => {
        // Exit early when there is no token to decode
        if (!token) {
          return cbk();
        }

        return decodeFirst(token, (err, decoded) => {
          if (!!err) {
            return cbk([400, 'FailedToDecodeServiceToken', {err}]);
          }

          if (!decoded) {
            return cbk([400, 'ExpectedEncodedServiceTokenData']);
          }

          if (!Buffer.isBuffer(decoded.macaroon)) {
            return cbk([400, 'ExpectedEncodedServiceTokenMacaroon']);
          }

          if (!Buffer.isBuffer(decoded.preimage)) {
            return cbk([400, 'ExpectedEncodedServiceTokenPreimage']);
          }

          return cbk(null, {
            macaroon: decoded.macaroon.toString('base64'),
            preimage: decoded.preimage.toString('hex'),
          });
        });
      }],

      // Get an unpaid swap macaroon
      getUnpaidMacaroon: ['decodeToken', ({decodeToken}, cbk) => {
        // Exit early when there is already a service token macaroon
        if (!!decodeToken) {
          return cbk(null, {macaroon: decodeToken.macaroon});
        }

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
        'getUnpaidMacaroon',
        'payForMacaroon',
        ({getUnpaidMacaroon, payForMacaroon}, cbk) =>
      {
        const {macaroon} = getUnpaidMacaroon;
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

        return cbk(null, {macaroon, paid, preimage, service, token});
      }],
    },
    returnResult({reject, resolve, of: 'service'}, cbk));
  });
};
