const {createHash} = require('crypto');
const {createHmac} = require('crypto');

const derEncodeSignature = require('./der_encode_signature');

const asDer = n => (n[0]&128)?Buffer.concat([Buffer.alloc(1),n],1+n.length):n;
const bufferAsHex = buffer => buffer.toString('hex');
const {from} = Buffer;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const hmacSha256 = (pk, url) => createHmac('sha256', pk).update(url).digest();
const sha256 = n => createHash('sha256').update(n).digest();
const utf8AsBuffer = utf8 => Buffer.from(utf8, 'utf8');

/** Sign an authentication challenge for LNURL Auth

  {
    ecp: <ECPair Object>
    hostname: <Domain for Authentication Challenge String>
    k1: <Challenge Nonce String>
    seed: <Seed Signature String>
  }

  @returns
  {
    public_key: <Signing Identity Public Key Hex String>
    signature: <Signature For Authentication Challenge Hex String>
  }
*/
module.exports = ({ecp, hostname, k1, seed}) => {
  // LUD-13: LN wallet defines hashingKey as sha256(signature)
  const hashingKey = sha256(utf8AsBuffer(seed));

  // LUD-13: linkingPrivKey is defined as hmacSha256(hashingKey, domain)
  const linkingPrivKey = hmacSha256(hashingKey, utf8AsBuffer(hostname));

  // Instantiate the key pair from this derived private key
  const linkingKey = ecp.fromPrivateKey(linkingPrivKey);

  // Using the host-specific linking key, sign the challenge k1 value
  const signature = bufferAsHex(from(linkingKey.sign(hexAsBuffer(k1))));

  return {
    public_key: bufferAsHex(linkingKey.publicKey),
    signature: derEncodeSignature({signature}).encoded,
  };
};
