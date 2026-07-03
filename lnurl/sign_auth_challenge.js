const {createHash} = require('crypto');
const {createHmac} = require('crypto');

const tinysecp256k1 = require('tiny-secp256k1');

const derEncodeSignature = require('./der_encode_signature');

const bufferAsHex = buffer => Buffer.from(buffer).toString('hex');
const derivePublicKey = key => tinysecp256k1.pointFromScalar(key, true);
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const hmacSha256 = (pk, url) => createHmac('sha256', pk).update(url).digest();
const {isPrivate} = tinysecp256k1;
const sha256 = n => createHash('sha256').update(n).digest();
const {sign} = tinysecp256k1;
const utf8AsBuffer = utf8 => Buffer.from(utf8, 'utf8');

/** Sign an authentication challenge for LNURL Auth

  {
    hostname: <Domain for Authentication Challenge String>
    k1: <Challenge Nonce String>
    seed: <Seed Signature String>
  }

  @throws
  <Error>

  @returns
  {
    public_key: <Signing Identity Public Key Hex String>
    signature: <Signature For Authentication Challenge Hex String>
  }
*/
module.exports = ({hostname, k1, seed}) => {
  // LUD-13: LN wallet defines hashingKey as sha256(signature)
  const hashingKey = sha256(utf8AsBuffer(seed));

  // LUD-13: linkingPrivKey is defined as hmacSha256(hashingKey, domain)
  const linkingPrivKey = hmacSha256(hashingKey, utf8AsBuffer(hostname));

  // Validate the private key
  if (!isPrivate(linkingPrivKey)) {
    throw new Error('ExpectedValidLinkingPrivateKey');
  }

  const publicKey = derivePublicKey(linkingPrivKey);

  if (!publicKey) {
    throw new Error('ExpectedPublicKeyFromLinkingPrivateKey');
  }

  // Using the host-specific linking key, sign the challenge k1 value
  const signature = bufferAsHex(sign(hexAsBuffer(k1), linkingPrivKey));

  return {
    public_key: bufferAsHex(publicKey),
    signature: derEncodeSignature({signature}).encoded,
  };
};
