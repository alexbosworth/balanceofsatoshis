const beginKey = '-----BEGIN PUBLIC KEY-----';
const endKey = '-----END PUBLIC KEY-----';
const split = /.{0,64}/g;

/** Get a DER encoded public key as a PEM encoded public key

  {
    pem: <Pem Encoded Public Key String>
  }

  @returns
  {
    der: <DER Public Key Hex Encoded String>
  }
*/
module.exports = ({pem}) => {
  const lines = pem.split('\n');

  lines.pop();

  lines.shift();

  const der = Buffer.from(lines.join(String()), 'base64');

  return {der};
};
