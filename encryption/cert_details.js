const byteArrayAsNumber = n => parseInt(Buffer.from(n).toString('hex'), 16);
const bytesCount = len => !!(128 & len) ? 127 & len : 0;
const containerTypes = [48, 49, 160, 161];
const dataStartIndex = 2;
const defaultLengthBytesCount = 0;
const hasLength = len => 128 & len;
const hasZero = (lead, type, len) => lead === 0 && [2,3].includes(type) && len;
const {isBuffer} = Buffer;
const makeDefaultState = () => ({count: 0, zeros: 0});
const maxNames = 102;
const valueTypes = [1, 2, 5, 7, 12, 130];

/** Derive cert data details

  {
    data: <Certificate Data Buffer Object>
  }

  @throws
  <Error>

  @returns (Nested)
  {
    children: [{
      value: <Value Buffer Object>
    }]
  }
*/
module.exports = args => {
  if (!isBuffer(args.data)) {
    throw new Error('ExpectedCertificateDataBufferObject');
  }

  const state = makeDefaultState();

  const [type, dataLength] = args.data;

  const asn1 = {
    index: dataStartIndex,
    length: dataLength,
    lengthBytesCount: bytesCount(dataLength),
  };

  if (hasLength(asn1.length)) {
    const len = args.data.slice(asn1.index, asn1.index+asn1.lengthBytesCount);

    asn1.index += asn1.lengthBytesCount;
    asn1.length = byteArrayAsNumber(len);
  }

  // Adjust for leading zero padding
  if (hasZero(args.data[asn1.index], type, asn1.length)) {
    asn1.index++;
    state.zeros++;
  }

  const adjustedLen = asn1.length - state.zeros;

  // Dive down into child values
  const parseChildren = () => {
    asn1.children = [];

    const byteLimit = (len, count) => 2 + len + count;

    const limit = byteLimit(asn1.length, asn1.lengthBytesCount);

    while (state.count < maxNames && asn1.index < limit) {
      state.count++;

      const data = args.data.slice(asn1.index, asn1.index + adjustedLen);

      state.child = module.exports({data});

      const adjust = state.child.lengthBytesCount + state.child.length;

      asn1.index += dataStartIndex + adjust;

      if (asn1.index > byteLimit(asn1.lengthBytesCount, asn1.length)) {
        throw new Error('InvalidLengthParsingAsn1');
      }

      asn1.children.push(state.child);
    }

    if (asn1.index !== byteLimit(asn1.lengthBytesCount, asn1.length)) {
      throw new Error("premature end-of-file");
    }

    if (state.count >= maxNames) {
      throw new Error('ExceededMaxNamesForCertificate');
    }

    delete asn1.value;

    return asn1;
  }

  // Type of data is a container, recurse into parsing children
  if (containerTypes.includes(type)) {
    return parseChildren();
  }

  asn1.value = args.data.slice(asn1.index, asn1.index + adjustedLen);

  // Type of data is a value, finished parsing here
  if (valueTypes.includes(type)) {
    return asn1;
  }

  // Recursively attempt to parse if possible
  try {
    return parseChildren();
  } catch (e) {
    asn1.children.length = defaultLengthBytesCount;

    // Nothing more is able to be parsed
    return asn1;
  }
};
