const hasLimits = n => !!n.max_htlc_mtokens && !!n.min_htlc_mtokens;
const hasRelay = n => n.base_fee_mtokens !== undefined && !!n.cltv_delta;
const isNumeric = n => typeof n === 'string' && /^\d+$/.test(n);

/** Find the issue that prevents a channel policy from relaying a payment

  {
    mtokens: <Payment Millitokens String>
    [policy]: {
      [base_fee_mtokens]: <Base Fee Millitokens String>
      [cltv_delta]: <Locktime Delta Number>
      [fee_rate]: <Fees Charged in Millitokens Per Million Number>
      [is_disabled]: <Channel Is Disabled Bool>
      [max_htlc_mtokens]: <Maximum HTLC Millitokens Value String>
      [min_htlc_mtokens]: <Minimum HTLC Millitokens Value String>
    }
  }

  @returns
  {
    [issue]: <Policy Cannot Relay Payment Reason String>
  }
*/
module.exports = ({mtokens, policy}) => {
  // Exit early when the amount is not a valid millitokens amount
  if (!isNumeric(mtokens)) {
    return {issue: 'amount is not a valid millitokens amount'};
  }

  // Exit early when the policy has not been announced by the peer
  if (!policy || !hasRelay(policy) || policy.fee_rate === undefined) {
    return {issue: 'peer routing policy for the channel is unknown'};
  }

  // Exit early when the peer disabled forwarding over the channel
  if (!!policy.is_disabled) {
    return {issue: 'peer disabled forwarding over the channel'};
  }

  // Exit early when the HTLC amount limits are not known
  if (!hasLimits(policy)) {
    return {issue: 'peer HTLC limits for the channel are unknown'};
  }

  // Exit early when the payment is smaller than the minimum forwardable
  if (BigInt(policy.min_htlc_mtokens) > BigInt(mtokens)) {
    return {issue: 'amount is below the peer minimum HTLC size'};
  }

  // Exit early when the payment is larger than the maximum forwardable
  if (BigInt(policy.max_htlc_mtokens) < BigInt(mtokens)) {
    return {issue: 'amount is above the peer maximum HTLC size'};
  }

  return {};
};
