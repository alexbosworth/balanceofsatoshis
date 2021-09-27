const {decodeChanId} = require('bolt07');

const {shuffle} = require('./../arrays');
const {isMatchingFilters} = require('./../display');

const sumOf = arr => arr.reduce((sum, n) => sum + n, Number());

/** Find a node for a tag query

  {
    channels: [{
      id: <Standard Format Channel Id String>
      local_balance: <Channel Local Balance Tokens Number>
      partner_public_key: <Peer Public Key Hex String>
      remote_balance: <Channel Local Balance Tokens Number>
    }]
    [filters]: [<Filter Expression String>]
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
    [matches]: [{
      [alias]: <Tag Alias String>
      id: <Tag Id Hex String>
      [nodes]: [<Public Key Hex String>]
    }]
  }
*/
module.exports = ({channels, filters, tags, query}) => {
  const peerKeys = channels.map(n => n.partner_public_key);

  // Find tags that match on id or on alias, and also have relevant nodes
  const matches = tags.filter(tag => {
    const nodes = (tag.nodes || []).filter(n => peerKeys.includes(n));

    if (!nodes.length) {
      return false;
    }

    const alias = tag.alias || String();

    const isAliasMatch = alias.toLowerCase().includes(query);
    const isIdMatch = tag.id.startsWith(query);

    return isAliasMatch || isIdMatch;
  });

  const [tagMatch, ...otherTagMatches] = matches;

  // Exit early when there are no matches at all
  if (!tagMatch) {
    return {};
  }

  // Exit early when there is ambiguity around the matching
  if (!!otherTagMatches.length) {
    return {matches};
  }

  // Get the array of nodes in the tag match
  const tagMatches = tagMatch.nodes.filter(n => peerKeys.includes(n));

  // Filter out matches in the array of peers that do not fulfill criteria
  const array = tagMatches
    .map(key => {
      if (!filters || !filters.length) {
        return {match: key};
      }

      const withPeer = channels.filter(n => n.partner_public_key === key);

      const matching = isMatchingFilters({
        filters: filters || [],
        variables: {
          heights: withPeer.map(n => decodeChanId({channel: n.id}).block_height),
          inbound_liquidity: sumOf(withPeer.map(n => n.remote_balance)),
          outbound_liquidity: sumOf(withPeer.map(n => n.local_balance)),
        },
      });

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
  if (!array.length) {
    return {};
  }

  // Exit early when there is a failure in the tag
  if (!!array.find(n => !!n.failure)) {
    return array.find(n => !!n.failure);
  }

  // Shuffle the results
  const {shuffled} = shuffle({array});

  const [{match}] = shuffled;

  return {match};
};
