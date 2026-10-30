const additionalInfoMask = 31;
const argumentSizes = {24: 1, 25: 2, 26: 4, 27: 8};
const arrayOfLength = length => [...Array(length)];
const firstSimpleValue = 20;
const {fromEntries} = Object;
const {isSafeInteger} = Number;
const isString = n => typeof n === 'string';
const majorTypeArray = 4;
const majorTypeBytes = 2;
const majorTypeMap = 5;
const majorTypeNegative = 1;
const majorTypeShift = 5;
const majorTypeSimple = 7;
const majorTypeText = 3;
const majorTypeUnsigned = 0;
const maxAdditionalInfo = 27;
const maxInitialNumber = 23;
const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
const simpleValues = [false, true, null, undefined];
const sizeOfLargestNumber = 8;

/** Decode the CBOR data item that starts at an index

  {
    data: <CBOR Encoded Data Buffer Object>
    start: <Start Index Number>
  }

  @throws
  <Error>

  @returns
  {
    end: <Index After the End of the Data Item Number>
    value: <Decoded Value Object>
  }
*/
module.exports = ({data, start}) => {
  if (start >= data.length) {
    throw new Error('UnexpectedEndOfCborData');
  }

  const info = data[start] & additionalInfoMask;
  const major = data[start] >> majorTypeShift;

  // Exit early when the item is false, true, null or undefined
  if (major === majorTypeSimple) {
    const index = info - firstSimpleValue;

    if (index < 0 || index >= simpleValues.length) {
      throw new Error('UnsupportedCborSimpleValue');
    }

    return {end: start + 1, value: simpleValues[index]};
  }

  // Indefinite lengths are not supported
  if (info > maxAdditionalInfo) {
    throw new Error('UnsupportedCborAdditionalInfo');
  }

  // A number too large for the initial byte follows after the initial byte
  const size = info > maxInitialNumber ? argumentSizes[info] : 0;

  const next = start + 1 + size;

  if (next > data.length) {
    throw new Error('UnexpectedEndOfCborData');
  }

  const readNumber = () => {
    // Exit early when the number is in the initial byte
    if (!size) {
      return info;
    }

    // Exit early when the number is in one, two or four bytes
    if (size !== sizeOfLargestNumber) {
      return data.readUIntBE(start + 1, size);
    }

    const number = data.readBigUInt64BE(start + 1);

    if (number > maxSafe) {
      throw new Error('UnsupportedLargeCborNumber');
    }

    return Number(number);
  };

  const number = readNumber();

  // Exit early when the item is an integer at or above zero
  if (major === majorTypeUnsigned) {
    return {end: next, value: number};
  }

  // Exit early when the item is a negative integer
  if (major === majorTypeNegative) {
    if (!isSafeInteger(-1 - number)) {
      throw new Error('UnsupportedLargeCborNumber');
    }

    return {end: next, value: -1 - number};
  }

  // Exit early when the item is bytes or text
  if (major === majorTypeBytes || major === majorTypeText) {
    const end = next + number;

    if (end > data.length) {
      throw new Error('UnexpectedEndOfCborData');
    }

    const bytes = Buffer.from(data.subarray(next, end));

    return {end, value: major === majorTypeText ? bytes.toString() : bytes};
  }

  // Exit early when the item is an array, decoding each item in order
  if (major === majorTypeArray) {
    // Every item takes up at least one byte
    if (number > data.length - next) {
      throw new Error('UnexpectedEndOfCborData');
    }

    const items = [];

    const end = arrayOfLength(number).reduce(at => {
      const item = module.exports({data, start: at});

      items.push(item.value);

      return item.end;
    },
    next);

    return {end, value: items};
  }

  if (major !== majorTypeMap) {
    throw new Error('UnsupportedCborTag');
  }

  // Every map entry takes up at least two bytes, a key and its value
  if (number * 2 > data.length - next) {
    throw new Error('UnexpectedEndOfCborData');
  }

  const entries = [];

  // Decode each key followed by its value
  const end = arrayOfLength(number).reduce(at => {
    const key = module.exports({data, start: at});

    if (!isString(key.value)) {
      throw new Error('ExpectedTextKeysInCborMap');
    }

    const item = module.exports({data, start: key.end});

    entries.push([key.value, item.value]);

    return item.end;
  },
  next);

  return {end, value: fromEntries(entries)};
};
