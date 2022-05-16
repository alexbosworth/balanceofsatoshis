const {encodeTlvStream} = require('bolt01');

const encodeConnectivityParams = require('./encode_connectivity_params');
const encodeFollowParams = require('./encode_follow_params');

const hexAsBase64 = hex => Buffer.from(hex, 'hex').toString('base64');
const methodConnectivity = '01';
const triggerPrefix = 'bos-trigger:';
const typeTriggerMethod = '1';
const typeTriggerParameters = '2';
const typeVersion = '0';
const version = '01';

/** Encode a trigger

  [0]: <Version>
  [1]: <Method>
  [2]: <Parameters>

  {
    [connectivity]: {
      id: <Node Id Hex String>
    }
    [follow]: {
      id: <Node Id Hex String>
    }
  }

  @throws
  <Error>

  @returns
  {
    encoded: <Encoded Trigger String>
  }
*/
module.exports = ({connectivity, follow}) => {
  if (!connectivity && !follow) {
    throw new Error('ExpectedConnectivityOrFollowDetailsToEncodeTrigger');
  }

  if (!!connectivity) {
    // Encode the trigger parameters for a connectivity trigger
    const {encoded} = encodeTlvStream({
      records: [
        {
          type: typeTriggerMethod,
          value: methodConnectivity,
        },
        {
          type: typeTriggerParameters,
          value: encodeConnectivityParams({id: connectivity.id}).encoded,
        },
        {
          type: typeVersion,
          value: version,
        },
      ],
    });

    return {encoded: `${triggerPrefix}${hexAsBase64(encoded)}`};
  }

  // Encode the trigger parameters for a follow trigger
  const {encoded} = encodeTlvStream({
    records: [{
      type: typeTriggerParameters,
      value: encodeFollowParams({id: follow.id}).encoded,
    }],
  });

  return {encoded: `${triggerPrefix}${hexAsBase64(encoded)}`};
};
