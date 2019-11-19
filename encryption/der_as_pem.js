const beginCert = '-----BEGIN CERTIFICATE-----';
const beginKey = '-----BEGIN PUBLIC KEY-----';
const endCert = '-----END CERTIFICATE-----';
const endKey = '-----END PUBLIC KEY-----';
const endMarker = 'ENDCERTIFICATE';
const notFoundIndex = -1;
const split = /.{0,64}/g;

/** Get a DER encoded public key as a PEM encoded public key

  {
    [cert]: <DER Certificate Hex Encoded String>
    [key]: <DER Public Key Hex Encoded String>
  }

  @returns
  {
    pem: <Pem Encoded Public Key String>
  }
*/
module.exports = ({cert, key}) => {
  const base64Key = Buffer.from(cert || key, 'hex').toString('base64');
  const endMarkLen = endMarker.length;

  const endCertIndex = base64Key.indexOf(endMarker);
  const keyLen = base64Key.length;

  const hasEndMark = endCertIndex !== notFoundIndex;

  const plusCount = keyLen - endCertIndex - endMarkLen;

  const endCut = hasEndMark ? -(plusCount + plusCount + endMarkLen) : keyLen;

  const pem = []
    .concat(!cert ? beginKey : beginCert)
    .concat(base64Key.slice(Number(), endCut).match(split).filter(n => !!n))
    .concat(!cert ? endKey : endCert)
    .join('\n');

  return {pem};
};
