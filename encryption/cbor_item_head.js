const additionalInfo = {1: 24, 2: 25, 4: 26, 8: 27};
const bitsPerByte = 8;
const largestSize = 8;
const majorTypeMultiplier = 32;
const maxInitialNumber = 23;
const sizes = [1, 2, 4];

/** Encode the head of a CBOR data item, its major type and its number

  {
    major: <Major Type Number>
    number: <Length or Value Number>
  }

  @returns
  {
    head: <Data Item Head Buffer Object>
  }
*/
module.exports = ({major, number}) => {
  const initial = major * majorTypeMultiplier;

  // Exit early when the number fits into the initial byte
  if (number <= maxInitialNumber) {
    return {head: Buffer.from([initial + number])};
  }

  // The number follows the initial byte, in as few bytes as it fits into
  const size = sizes.find(n => number < 2 ** (n * bitsPerByte)) || largestSize;

  const head = Buffer.alloc(1 + size);

  head[0] = initial + additionalInfo[size];

  // Exit early when the number needs all eight bytes
  if (size === largestSize) {
    head.writeBigUInt64BE(BigInt(number), 1);

    return {head};
  }

  head.writeUIntBE(number, 1, size);

  return {head};
};
