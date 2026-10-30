const asyncAuto = require('async/auto');
const asyncify = require('async/asyncify');
const {returnResult} = require('asyncjs-util');

const {decodeCbor} = require('./../encryption');

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
      decode: ['validate', asyncify(() => {
        let decoded;

        try {
          decoded = decodeCbor({cbor: key}).value;
        } catch (err) {
          throw [400, 'FailedToDecodeServiceToken', {err}];
        }

        if (!decoded) {
          throw [400, 'ExpectedEncodedServiceTokenData'];
        }

        if (!Buffer.isBuffer(decoded.macaroon)) {
          throw [400, 'ExpectedEncodedServiceTokenMacaroon'];
        }

        if (!Buffer.isBuffer(decoded.preimage)) {
          throw [400, 'ExpectedEncodedServiceTokenPreimage'];
        }

        return {
          macaroon: decoded.macaroon.toString('base64'),
          preimage: decoded.preimage.toString('hex'),
        };
      })],
    },
    returnResult({reject, resolve, of: 'decode'}, cbk));
  });
};
