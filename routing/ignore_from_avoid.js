const flatten = arr => [].concat(...arr);
const isPublicKey = n => /^[0-9A-F]{66}$/i.test(n.from_public_key);
const notFoundIndex = -1;

/** Ignore from avoid

  {
    avoid: <Avoid Public Key Hex String>
  }

  @throws
  <Error>

  @returns via cbk
  {
    ignore: [{
      from_public_key: <From Public Key Hex String>
    }]
  }
*/
module.exports = ({avoid}) => {
  const ignore = flatten([avoid].filter(n => !!n))
    .map(n => ({from_public_key: n}));

  if (ignore.findIndex(n => !isPublicKey(n)) !== notFoundIndex) {
    throw new Error('ExpectedHexEncodedPublicKeyToAvoid');
  }

  return {ignore};
};
