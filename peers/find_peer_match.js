const {decodeChanId} = require('bolt07');

const {shuffle} = require('./../arrays');
const {isMatchingFilters} = require('./../display');

const channelHeight = channel => decodeChanId({channel}).block_height;
const {max} = Math;
const sumOf = arr => arr.reduce((sum, n) => sum + n, Number());
const tok = n => Number(BigInt(n) / BigInt(1e3));
const uniq = arr => Array.from(new Set(arr));

/** Find a peer that matches filters

  {
    channels: [{
      capacity: <Channel Token Capacity Number>
      id: <Standard Format Channel Id String>
      local_balance: <Channel Local Balance Tokens Number>
      partner_public_key: <Peer Public Key Hex String>
      pending_payments: [<Pending Payment Object>]
      remote_balance: <Channel Remote Balance Tokens Number>
    }]
    [filters]: [<Filter Expression String>]
    policies: [{
      [base_fee_mtokens]: <Remote Base Fee Charged In Millitokens Number>
      [fee_rate]: <Remote Fees Charged in Millitokens Per Million Number>
      [is_disabled]: <Remote Channel Forwarding Is Disabled Bool>
      public_key: <Remote Public Key Hex String>
    }]
    nodes: [<Candidate Peer Public Key Hex String>]
  }

  @returns
  {
    [failure]: {
      error: <Error String>
      formula: <Errored Formula String>
    }
    [match]: <Matching Peer Public Key Hex String>
  }
*/
module.exports = ({channels, filters, nodes, policies}) => {
  const disabled = policies.filter(n => n.is_disabled).map(n => n.public_key);

  const peers = channels.map(n => n.partner_public_key)
    .filter(n => !disabled.includes(n));

  const candidates = uniq((nodes || [])
    .filter(n => peers.includes(n)));

  // Filter out peers that do not fulfill the supplied criteria
  const candidateResults = candidates
    .map(key => {
      if (!filters || !filters.length) {
        return {match: key};
      }

      const peerPolicies = policies.filter(n => n.public_key === key);
      const withPeer = channels.filter(n => n.partner_public_key === key);

      const feeRates = peerPolicies.filter(n => n.fee_rate !== undefined);
      const pendingPayments = withPeer.map(n => n.pending_payments.length);

      const maxBaseFee = max(...feeRates.map(n => tok(n.base_fee_mtokens)));
      const maxFeeRate = max(...feeRates.map(n => n.fee_rate));

      const variables = {
        capacity: sumOf(withPeer.map(n => n.capacity)),
        heights: withPeer.map(n => channelHeight(n.id)),
        inbound_liquidity: sumOf(withPeer.map(n => n.remote_balance)),
        outbound_liquidity: sumOf(withPeer.map(n => n.local_balance)),
        pending_payments: sumOf(pendingPayments),
      };

      if (!!feeRates.length) {
        variables.inbound_base_fee = maxBaseFee;
        variables.inbound_fee_rate = maxFeeRate;
      }

      const matching = isMatchingFilters({variables, filters: filters || []});

      if (!!matching.failure) {
        return matching;
      }

      if (!matching.is_matching) {
        return;
      }

      return {match: key};
    })
    .filter(n => !!n);

  // Exit early when there is no match
  if (!candidateResults.length) {
    return {};
  }

  // Exit early when there is a failure in a candidate
  if (!!candidateResults.find(n => !!n.failure)) {
    return candidateResults.find(n => !!n.failure);
  }

  const {shuffled} = shuffle({array: candidateResults});

  const [{match}] = shuffled;

  return {match};
};
