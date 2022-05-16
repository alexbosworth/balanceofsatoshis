const {decodeTlvStream} = require('bolt01');

const decodeFollowParams = require('./decode_follow_params');

const base64AsHex = base64 => Buffer.from(base64, 'base64').toString('hex');
const findRecord = (records, type) => records.find(n => n.type === type);
const triggerPrefix = 'bos-trigger:';
const typeParams = '2';
const typeVersion = '0';

/** Decode an encoded trigger

  {
    encoded: <Encoded Trigger String>
  }

  @throws <Error>

  @returns
  {
    follow: {
      id: <Node Id Hex String>
    }
  }
*/
module.exports = ({encoded}) => {
  if (!encoded) {
    throw new Error('ExpectedEncodedTriggerToDecode');
  }

  if (!encoded.startsWith(triggerPrefix)) {
    throw new Error('ExpectedTriggerPrefixForEncodedPrefix');
  }

  const data = base64AsHex(encoded.slice(triggerPrefix.length));

  const {records} = decodeTlvStream({encoded: data});

  // Check the trigger version
  if (!!findRecord(records, typeVersion)) {
    throw new Error('UnexpectedVersionForEncodedTrigger');
  }

  // Trigger parameters are encoded into a stream record
  const parametersRecord = findRecord(records, typeParams);

  if (!parametersRecord) {
    throw new Error('ExpectedParametersForTrigger');
  }

  const follow = decodeFollowParams({parameters: parametersRecord.value});

  return {follow};
};
