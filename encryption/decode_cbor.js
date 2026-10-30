const decodeCborItem = require('./decode_cbor_item');

const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const isString = n => typeof n === 'string';

/** Decode CBOR encoded data

  {
    cbor: <CBOR Encoded Hex String>
  }

  @throws
  <Error>

  @returns
  {
    value: <Decoded Value Object>
  }
*/
module.exports = ({cbor}) => {
  if (!isString(cbor)) {
    throw new Error('ExpectedHexEncodedCborToDecode');
  }

  const data = hexAsBuffer(cbor);

  const {end, value} = decodeCborItem({data, start: 0});

  // The data has to be a single item, with nothing left over
  if (end !== data.length) {
    throw new Error('UnexpectedDataAfterCborItem');
  }

  return {value};
};
