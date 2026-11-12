const {randomBytes} = require('node:crypto');

const {newMacaroon} = require('macaroon');

const {macaroonLocation} = require('./../constants');
const {macaroonVersion} = require('./../constants');

const bufferAsBase64 = buffer => Buffer.from(buffer).toString('base64');
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const idByteLength = 32;
const rootKeyByteLength = 32;
const serializationVersion = 2;

/** Make a swap service macaroon that is unlocked by paying a payment hash

  {
    hash: <Payment Hash Hex String>
  }

  @returns
  {
    macaroon: <Macaroon Base64 String>
  }
*/
module.exports = ({hash}) => {
  // The identifier is the version, the payment hash and a random user id
  const identifier = Buffer.concat([
    hexAsBuffer(macaroonVersion),
    hexAsBuffer(hash),
    randomBytes(idByteLength),
  ]);

  const macaroon = newMacaroon({
    identifier,
    location: macaroonLocation,
    rootKey: randomBytes(rootKeyByteLength),
    version: serializationVersion,
  });

  return {macaroon: bufferAsBase64(macaroon.exportBinary())};
};
