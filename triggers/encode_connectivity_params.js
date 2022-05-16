const {encodeTlvStream} = require('bolt01');

const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const typeNodeId = '1';

/** Encode the connectivity with node params

  [0]: <Version>
  1: <Node Id>

  {
    id: <Node Identity Public Key Hex String>
  }

  @throws
  <Error>

  @returns
  {
    encoded: <Trigger Parameters Hex String>
  }
*/
module.exports = ({id}) => {
  if (!isPublicKey(id)) {
    throw new Error('ExpectedPublicKeyToEncodeConnectivityParams');
  }

  return encodeTlvStream({records: [{type: typeNodeId, value: id}]});
};
