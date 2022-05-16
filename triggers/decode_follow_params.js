const {decodeTlvStream} = require('bolt01');

const findRecord = (records, type) => records.find(n => n.type === type);
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const typeId = '1';
const typeVersion = '0';

/** Decode follow trigger parameters

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
    throw new Error('ExpectedEncodedParametersToDecodeFollowParameters');
  }

  const {records} = decodeTlvStream({encoded: parameters});

  // Check the parameters version
  if (!!findRecord(records, typeVersion)) {
    throw new Error('UnexpectedVersionForEncodedTrigger');
  }

  const idRecord = findRecord(records, typeId);

  if (!idRecord) {
    throw new Error('ExpectedNodePublicKeyForEncodedTrigger');
  }

  if (!isPublicKey(idRecord.value)) {
    throw new Error('ExpectedValidNodePublicKeyForEncodedTrigger');
  }

  return {id: idRecord.value};
};
