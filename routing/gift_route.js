const {routeFromChannels} = require('bolt07');

const defaultBaseFeeMtokens = '1000';
const defaultFeeRate = 1;
const defaultMin = '1000';
const feeRateDivisor = BigInt(1e6);
const {isArray} = Array;
const minFeeRate = 0;
const mtokPerTok = BigInt(1e3);

/** Get a gift route

  {
    channel: [{
      id: <Channel Id String>
      policies: [{
        base_fee_mtokens: <Base Fee Millitokens String>
        cltv_delta: <CLTV Delta Number>
        fee_rate: <Fee Rate Number>
        min_htlc_mtokens: <Minimum HTLC Tokens Number>
        public_key: <Forwarding Public Key Hex String>
      }]
    }]
    destination: <Destination Public Key Hex String>
    height: <Current Best Tip Block Height Number>
    [payment]: <Payment Identifier Hex String>
    tokens: <Tokens to Gift Number>
  }

  @throws
  <Error>

  @returns
  {
    route: {
      fee: <Total Fee Tokens To Pay Number>
      fee_mtokens: <Total Fee Millitokens To Pay String>
      hops: [{
        channel: <Standard Format Channel Id String>
        channel_capacity: <Channel Capacity Tokens Number>
        fee: <Fee Number>
        fee_mtokens: <Fee Millitokens String>
        forward: <Forward Tokens Number>
        forward_mtokens: <Forward Millitokens String>
        [public_key]: <Public Key Hex String>
        timeout: <Timeout Block Height Number>
      }]
      mtokens: <Total Fee-Inclusive Millitokens String>
      timeout: <Timeout Block Height Number>
      tokens: <Total Fee-Inclusive Tokens Number>
    }
  }
*/
module.exports = ({channel, destination, height, payment, tokens}) => {
  if (!channel) {
    throw new Error('ExpectedChannelToCalculateGiftRoute');
  }

  if (!destination) {
    throw new Error('ExpectedDestinationToCalculateGiftRoute');
  }

  if (!height) {
    throw new Error('ExpectedHeightToCalculateGiftRoute');
  }

  if (!tokens) {
    throw new Error('ExpectedTokensToCalculateGiftRoute');
  }

  const {policies} = channel;

  if (!isArray(policies) || !!policies.find(n => !n.public_key)) {
    throw new Error('ExpectedChannelPoliciesToCalculateGiftRoute');
  }

  const policy = policies.find(n => n.public_key === destination);

  if (!policy) {
    throw new Error('ExpectedDestinationPolicyToCalculateGiftRoute');
  }

  const peerPolicy = policies.find(n => n.public_key !== destination);

  if (!peerPolicy) {
    throw new Error('ExpectedPeerPolicyToCalculateGiftRoute');
  }

  const minReceivableMtokens = BigInt(policy.min_htlc_mtokens || defaultMin);
  const minSendableMtokens = BigInt(peerPolicy.min_htlc_mtokens || defaultMin);

  const mtokens = minReceivableMtokens.toString();
  const mtokensToGive = BigInt(tokens) * mtokPerTok;

  if (minSendableMtokens > minReceivableMtokens) {
    throw new Error('PeerPolicyTooLowToCompleteForward');
  }

  const baseFee = BigInt(peerPolicy.base_fee_mtokens || defaultBaseFeeMtokens);
  const feeRate = BigInt(peerPolicy.fee_rate || defaultFeeRate);

  const standardFee = (BigInt(mtokens) * feeRate / feeRateDivisor) + baseFee;

  // Make sure that the real fee is going to be lower than the gift
  if (standardFee > mtokensToGive) {
    throw new Error('GiftAmountTooLowToSend');
  }

  peerPolicy.base_fee_mtokens = mtokensToGive.toString();
  peerPolicy.fee_rate = minFeeRate;

  const channels = [channel, channel];

  const {route} = routeFromChannels({
    channels,
    destination,
    height,
    mtokens,
    payment,
    total_mtokens: !!payment ? mtokens : undefined,
  });

  return {route};
};
