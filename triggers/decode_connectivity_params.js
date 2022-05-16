const {decodeTlvStream} = require('bolt01');

const findRecord = (records, type) => records.find(n => n.type === type);
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const typeId = '1';
const typeVersion = '0';

/** Decode connectivity trigger parameters

  {
    parameters: <Encoded Parameters Hex String>
  }

  @throws
  <Error>

  @returns
  {
    id: <Node Id Hex String>
  }
*/
module.exports = ({parameters}) => {
  if (!parameters) {
    throw new Error('ExpectedEncodedParametersToDecodeConnectivityParameters');
  }

  const {records} = decodeTlvStream({encoded: parameters});

  // Check the parameters version
  if (!!findRecord(records, typeVersion)) {
    throw new Error('UnexpectedVersionForEncodedConnectivityTrigger');
  }

  const idRecord = findRecord(records, typeId);

  if (!idRecord) {
    throw new Error('ExpectedNodePublicKeyForEncodedConnectivityTrigger');
  }

  if (!isPublicKey(idRecord.value)) {
    throw new Error('ExpectedValidNodePublicKeyForEncodedConnectivityTrigger');
  }

  return {id: idRecord.value};
};
