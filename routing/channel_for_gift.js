const {sortBy} = require('./../arrays');

const {isArray} = Array;
const reserveValue = n => n.local_reserve || Math.floor(n.capacity * 0.01);

/** Channel with sufficient balance for a circular gift route

  {
    channels: [{
      capacity: <Channel Capacity Tokens Number>
      is_active: <Channel is Active Bool>
      local_balance: <Local Balance Tokens Number>
      [local_reserve]: <Local Reserve Tokens Number>
      partner_public_key: <Peer Public Key Hex String>
      remote_balance: <Remote Balance Tokens Number>
    }]
    to: <Channel With Peer Public Key Hex String>
    tokens: <Tokens To Send Number>
  }

  @throws
  <Error>

  @returns
  {
    id: <Standard Format Channel Id String>
  }
*/
module.exports = ({channels, to, tokens}) => {
  if (!isArray(channels)) {
    throw new Error('ExpectedArrayOfChannelsToFindChannelWithBalance');
  }

  if (channels.find(n => !n) !== undefined) {
    throw new Error('ExpectedChannelsInArrayOfChannels');
  }

  if (!to) {
    throw new Error('ExpectedToPublicKeyToFindChannelWithBalance');
  }

  if (!tokens) {
    throw new Error('ExpectedTokensToFindChannelWithSufficientBalance');
  }

  const withPeer = channels.filter(n => n.partner_public_key === to);

  if (!withPeer.length) {
    throw new Error('NoDirectChannelWithSpecifiedPeer');
  }

  const active = withPeer.filter(n => !!n.is_active);

  if (!active.length) {
    throw new Error('NoActiveChannelWithSpecifiedPeer');
  }

  const hasTokens = active.filter(channel => {
    return channel.local_balance - tokens > reserveValue(channel);
  });

  if (!hasTokens.length) {
    throw new Error('NoActiveChannelWithSufficientLocalBalance');
  }

  const array = hasTokens.filter(channel => {
    return channel.remote_balance + tokens > reserveValue(channel)
  });

  if (!array.length) {
    throw new Error('NoActiveChannelWithSufficientRemoteBalance');
  }

  const [{id}] = sortBy({array, attribute: 'local_balance'}).sorted;

  return {id};
};
