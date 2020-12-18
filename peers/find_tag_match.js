const {shuffle} = require('./../arrays');

/** Find a node for a tag query

  {
    channels: [{
      partner_public_key: <Peer Public Key Hex String>
    }]
    query: <Query String>
    tags: [{
      [alias]: <Tag Alias String>
      id: <Tag Id Hex String>
      [nodes]: [<Public Key Hex String>]
    }]
  }

  @returns
  {
    [match]: <Matching Node Public Key Hex String>
    [matches]: [{
      [alias]: <Tag Alias String>
      id: <Tag Id Hex String>
      [nodes]: [<Public Key Hex String>]
    }]
  }
*/
module.exports = ({channels, tags, query}) => {
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
  const array = tagMatch.nodes.filter(n => peerKeys.includes(n));

  // Shuffle the results
  const {shuffled} = shuffle({array});

  const [match] = shuffled;

  return {match};
};
