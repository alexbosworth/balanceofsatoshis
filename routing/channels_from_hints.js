const {parsePaymentRequest} = require('ln-service');

const defaultCapacity = Number.MAX_SAFE_INTEGER;

/** Derive channels back from hop hints

  {
    [request]: <BOLT 11 Request String>
  }

  @returns
  {
    channels: [{
      capacity: <Maximum Tokens Number>
      id: <Standard Format Channel Id String>
      policies: [{
        [base_fee_mtokens]: <Base Fee Millitokens String>
        [cltv_delta]: <Locktime Delta Number>
        [fee_rate]: <Fees Charged Per Million Tokens Number>
        [is_disabled]: <Channel Is Disabled Bool>
        [max_htlc_mtokens]: <Maximum HTLC Millitokens Value String>
        [min_htlc_mtokens]: <Minimum HTLC Millitokens Value String>
        public_key: <Node Public Key String>
        [updated_at]: <Edge Last Updated At ISO 8601 Date String>
      }]
      transaction_id: <Transaction Id Hex String>
      transaction_vout: <Transaction Output Index Number>
      [updated_at]: <Channel Last Updated At ISO 8601 Date String>
    }]
  }
*/
module.exports = ({request}) => {
  const channels = [];

  // Exit early when there is no request to derive channels for
  if (!request) {
    return {channels};
  }

  const {routes} = parsePaymentRequest({request});

  // Exit early when there are no hop hints in the requests
  if (!routes) {
    return {channels};
  }

  routes.forEach(route => {
    return route.forEach((hop, i) => {
      // Skip the first hop which is just an anchor
      if (!i) {
        return;
      }

      channels.push({
        capacity: defaultCapacity,
        destination: hop.public_key,
        id: hop.channel,
        policies: [
          {
            base_fee_mtokens: hop.base_fee_mtokens,
            cltv_delta: hop.cltv_delta,
            fee_rate: hop.fee_rate,
            public_key: route[--i].public_key,
          },
          {
            public_key: hop.public_key,
          },
        ],
      });
    });
  });

  return {channels};
};
