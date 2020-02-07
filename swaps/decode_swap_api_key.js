const asyncAuto = require('async/auto');
const {decodeFirst} = require('cbor');
const {returnResult} = require('asyncjs-util');

/** Decode Swap API Key

  {
    key: <CBOR Encoded API Key String>
  }

  @returns via cbk or Promise
  {
    macaroon: <Base64 Encoded Macaroon String>
    preimage: <Hex Encoded Preimage String>
  }
*/
module.exports = ({key}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!key) {
          return cbk([400, 'ExpectedApiKeyToDecode']);
        }

        return cbk();
      },

      // Decode the encoded key
      decode: ['validate', ({}, cbk) => {
        return decodeFirst(key, (err, decoded) => {
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
    },
    returnResult({reject, resolve, of: 'decode'}, cbk));
  });
};
