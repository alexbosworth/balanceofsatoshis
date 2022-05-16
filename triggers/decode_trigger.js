const {decodeTlvStream} = require('bolt01');

const decodeConnectivityParams = require('./decode_connectivity_params');
const decodeFollowParams = require('./decode_follow_params');

const base64AsHex = base64 => Buffer.from(base64, 'base64').toString('hex');
const defaultMethodRecord = {value: '00'};
const defaultVersionRecord = {value: '00'};
const findRecord = (records, type) => records.find(n => n.type === type);
const knownVersions = ['00', '01'];
const methodConnectivity = '01';
const methodFollow = '00';
const triggerPrefix = 'bos-trigger:';
const typeMethod = '1';
const typeParams = '2';
const typeVersion = '0';

/** Decode an encoded trigger

  {
    encoded: <Encoded Trigger String>
  }

  @throws <Error>

  @returns
  {
    [connectivity]: {
      id: <Node Id Hex String>
    }
    [follow]: {
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

  const version = findRecord(records, typeVersion) || defaultVersionRecord;

  // Check the trigger version
  if (!knownVersions.includes(version.value)) {
    throw new Error('UnexpectedVersionForEncodedTrigger');
  }

  const methodRecord = findRecord(records, typeMethod) || defaultMethodRecord;

  // Trigger parameters are encoded into a stream record
  const parametersRecord = findRecord(records, typeParams);

  if (!parametersRecord) {
    throw new Error('ExpectedParametersForTrigger');
  }

  const parameters = parametersRecord.value;

  switch (methodRecord.value) {
  case methodConnectivity:
    const connectivity = decodeConnectivityParams({parameters});

    return {connectivity};

  case methodFollow:
    const follow = decodeFollowParams({parameters});

    return {follow};

  default:
    throw new Error('UnrecognizedMethodTypeForTrigger');
  }
};
