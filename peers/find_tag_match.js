const findPeerMatch = require('./find_peer_match');

/** Find a node for a tag query

  {
    channels: [{
      capacity: <Channel Token Capacity Number>
      id: <Standard Format Channel Id String>
      local_balance: <Channel Local Balance Tokens Number>
      partner_public_key: <Peer Public Key Hex String>
      remote_balance: <Channel Local Balance Tokens Number>
    }]
    [filters]: [<Filter Expression String>]
    policies: {
      [base_fee_mtokens]: <Remote Base Fee Charged In Millitokens Number>
      [fee_rate]: <Remote Fees Charged in Millitokens Per Million Number>
      [is_disabled]: <Remote Channel Forwarding Is Disabled Bool>
      public_key: <Remote Public Key Hex String>
    }
    query: <Query String>
    tags: [{
      [alias]: <Tag Alias String>
      id: <Tag Id Hex String>
      [nodes]: [<Public Key Hex String>]
    }]
  }

  @returns
  {
    [failure]: {
      error: <Error String>
      formula: <Errored Formula String>
    }
    [match]: <Matching Node Public Key Hex String>
    [is_tag_filtered]: <Tag Matched But All Nodes Failed Filters Bool>
    [matches]: [{
      [alias]: <Tag Alias String>
      id: <Tag Id Hex String>
      [nodes]: [<Public Key Hex String>]
    }]
  }
*/
module.exports = ({channels, filters, policies, tags, query}) => {
  const disabled = policies.filter(n => n.is_disabled).map(n => n.public_key);

  const peerKeys = channels
    .map(n => n.partner_public_key)
    .filter(n => !disabled.includes(n));

  // Find tags that match on id or on alias
  const tagMatches = tags.filter(tag => {
    const alias = tag.alias || String();

    const isAliasMatch = alias.toLowerCase() === (query || '').toLowerCase();
    const isIdMatch = tag.id.startsWith(query);

    return isAliasMatch || isIdMatch;
  });

  // Limit tag matches to tags with relevant peers
  const matches = tagMatches.filter(tag => {
    return (tag.nodes || []).some(n => peerKeys.includes(n));
  });

  const [tagMatch, ...otherTagMatches] = matches;

  // Exit early when there are no matches at all
  if (!tagMatch && !!tagMatches.length && !!filters && !!filters.length) {
    return {is_tag_filtered: true};
  }

  if (!tagMatch) {
    return {};
  }

  // Exit early when there is ambiguity around the matching
  if (!!otherTagMatches.length) {
    return {matches};
  }

  const {failure, match} = findPeerMatch({
    channels,
    filters,
    policies,
    nodes: tagMatch.nodes.filter(n => peerKeys.includes(n)),
  });

  if (!failure && !match && !!filters && !!filters.length) {
    return {is_tag_filtered: true};
  }

  return {failure, match};
};
