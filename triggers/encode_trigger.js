const {encodeTlvStream} = require('bolt01');

const encodeFollowParams = require('./encode_follow_params');

const hexAsBase64 = hex => Buffer.from(hex, 'hex').toString('base64');
const triggerPrefix = 'bos-trigger:';
const typeTriggerParameters = '2';

/** Encode a trigger

  [0]: <Version>
  [1]: <Method>
  [2]: <Parameters>

  {
    follow: {
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
module.exports = ({follow}) => {
  if (!follow) {
    throw new Error('ExpectedFollowDetailsToEncodeTrigger');
  }

  // Encode the trigger parameters
  const {encoded} = encodeTlvStream({
    records: [{
      type: typeTriggerParameters,
      value: encodeFollowParams({id: follow.id}).encoded,
    }],
  });

  return {encoded: `${triggerPrefix}${hexAsBase64(encoded)}`};
};
