const encodeCborItem = require('./encode_cbor_item');

const bufferAsHex = buffer => buffer.toString('hex');

/** Encode a value as CBOR

  {
    value: <Value to Encode Object>
  }

  @throws
  <Error>

  @returns
  {
    cbor: <CBOR Encoded Hex String>
  }
*/
module.exports = ({value}) => {
  return {cbor: bufferAsHex(encodeCborItem({value}).encoded)};
};
