const cborItemHead = require('./cbor_item_head');

const {concat} = Buffer;
const firstSimpleValue = 20;
const {isArray} = Array;
const {isBuffer} = Buffer;
const isMap = n => !!n && Object.getPrototypeOf(n) === Object.prototype;
const isNumber = n => typeof n === 'number';
const {isSafeInteger} = Number;
const isString = n => typeof n === 'string';
const {keys} = Object;
const majorTypeArray = 4;
const majorTypeBytes = 2;
const majorTypeMap = 5;
const majorTypeNegative = 1;
const majorTypeSimple = 7;
const majorTypeText = 3;
const majorTypeUnsigned = 0;
const simpleValues = [false, true, null, undefined];

/** Encode a value as a CBOR data item

  {
    value: <Value to Encode Object>
  }

  @throws
  <Error>

  @returns
  {
    encoded: <CBOR Encoded Data Item Buffer Object>
  }
*/
module.exports = ({value}) => {
  const encodeItem = item => module.exports({value: item}).encoded;
  const head = (major, number) => cborItemHead({major, number}).head;

  // Exit early when the value is false, true, null or undefined
  if (simpleValues.includes(value)) {
    const number = firstSimpleValue + simpleValues.indexOf(value);

    return {encoded: head(majorTypeSimple, number)};
  }

  // Exit early when the value is bytes
  if (isBuffer(value)) {
    return {encoded: concat([head(majorTypeBytes, value.length), value])};
  }

  // Exit early when the value is text
  if (isString(value)) {
    const text = Buffer.from(value, 'utf8');

    return {encoded: concat([head(majorTypeText, text.length), text])};
  }

  // Exit early when the value is an integer at or above zero
  if (isSafeInteger(value) && value >= 0) {
    return {encoded: head(majorTypeUnsigned, value)};
  }

  // Exit early when the value is a negative integer
  if (isSafeInteger(value)) {
    return {encoded: head(majorTypeNegative, -1 - value)};
  }

  // Only integers are supported, not fractions or very large numbers
  if (isNumber(value)) {
    throw new Error('UnsupportedNumberToEncodeAsCbor');
  }

  // Exit early when the value is an array, encode each item in order
  if (isArray(value)) {
    const items = value.map(item => encodeItem(item));

    return {encoded: concat([head(majorTypeArray, value.length), ...items])};
  }

  if (!isMap(value)) {
    throw new Error('UnsupportedValueToEncodeAsCbor');
  }

  // A map is encoded as each key followed by its value
  const entries = keys(value).map(key => {
    return concat([encodeItem(key), encodeItem(value[key])]);
  });

  return {encoded: concat([head(majorTypeMap, entries.length), ...entries])};
};
