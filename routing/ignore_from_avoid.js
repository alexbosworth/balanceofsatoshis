const flatten = arr => [].concat(...arr);

/** Ignore from avoid

  {
    avoid: <Avoid Public Key Hex String>
  }

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

  return {ignore};
};
