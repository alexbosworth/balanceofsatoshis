const {createHash} = require('node:crypto');

const {importMacaroon} = require('macaroon');

const {authHeader} = require('./../constants');
const {authScheme} = require('./../constants');
const {macaroonVersion} = require('./../constants');

const bufferAsHex = buffer => Buffer.from(buffer).toString('hex');
const hashByteLength = 32;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const isPreimage = n => !!n && /^[0-9A-F]{64}$/i.test(n);
const sha256 = preimage => createHash('sha256').update(preimage).digest('hex');
const versionByteLength = 2;

const hashEnd = versionByteLength + hashByteLength;

/** Authenticate a swap request by its paid macaroon header

  {
    metadata: <gRPC Request Metadata Object>
  }

  @returns
  {
    [hash]: <Paid Macaroon Payment Hash Hex String>
  }
*/
module.exports = ({metadata}) => {
  const [authorization] = metadata.get(authHeader);

  // Exit early when there is no authorization header
  if (!authorization) {
    return {};
  }

  const [scheme, token] = authorization.split(' ');

  // Exit early when the authorization is not a paid macaroon
  if (scheme !== authScheme || !token) {
    return {};
  }

  // The token is the macaroon and the preimage that paid for the macaroon
  const [macaroon, preimage] = token.split(':');

  // Exit early when the preimage is not a preimage
  if (!macaroon || !isPreimage(preimage)) {
    return {};
  }

  try {
    importMacaroon(macaroon);
  } catch (err) {
    return {};
  }

  const {identifier} = importMacaroon(macaroon);

  const id = Buffer.from(identifier);

  const version = bufferAsHex(id.subarray(Number(), versionByteLength));

  // Exit early when the macaroon is not a swap macaroon
  if (version !== macaroonVersion) {
    return {};
  }

  const hash = bufferAsHex(id.subarray(versionByteLength, hashEnd));

  // Exit early when the preimage does not unlock the macaroon
  if (sha256(hexAsBuffer(preimage)) !== hash) {
    return {};
  }

  return {hash};
};
