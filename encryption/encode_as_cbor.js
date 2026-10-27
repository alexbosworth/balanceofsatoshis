const {Encoder} = require('cbor');

const bufferAsHex = buffer => buffer.toString('hex');

/** Encode a value as CBOR

  {
    value: <Value to Encode Object>
  }

  @returns
  {
    cbor: <CBOR Encoded Hex String>
  }
*/
module.exports = ({value}) => {
  const chunks = [];
  const encoder = new Encoder();

  // Gather the encoding as it is emitted, reading it later can cut it short
  encoder.on('data', chunk => chunks.push(chunk));

  encoder.pushAny(value);

  encoder.end();

  return {cbor: bufferAsHex(Buffer.concat(chunks))};
};
