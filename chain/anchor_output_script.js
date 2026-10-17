const {createHash} = require('node:crypto');

const {p2wshOutputScript} = require('@alexbosworth/blockchain');
const {scriptElementsAsScript} = require('@alexbosworth/blockchain');

const bufferAsHex = buffer => buffer.toString('hex');
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const OP_16 = 96;
const OP_CHECKSEQUENCEVERIFY = 178;
const OP_CHECKSIG = 172;
const OP_ENDIF = 104;
const OP_IFDUP = 115;
const OP_NOTIF = 100;
const sha256 = preimage => createHash('sha256').update(preimage).digest();

/** Derive the anchor output script for a funding public key

  {
    key: <Funding Public Key Hex String>
  }

  @returns
  {
    script: <Anchor P2WSH Output Script Hex String>
  }
*/
module.exports = ({key}) => {
  const {script} = scriptElementsAsScript({
    elements: [
      hexAsBuffer(key),
      OP_CHECKSIG,
      OP_IFDUP,
      OP_NOTIF,
      OP_16,
      OP_CHECKSEQUENCEVERIFY,
      OP_ENDIF,
    ],
  });

  const hash = sha256(hexAsBuffer(script));

  return {script: bufferAsHex(p2wshOutputScript({hash}).script)};
};
