const {sortBy} = require('./../arrays');

const attribute = 'local_balance';

/** Choose a channel to use for a send

  {
    channels: [{
      id: <Standard Format Channel Id String>
      local_balance: <Local Tokens Balance Number>
      local_reserve: <Local Reserve Required Amount Number>
      partner_public_key: <Peer Public Key Hex String>
    }]
    peer: <Peer Public Key Hex String>
    tokens: <Tokens Number>
  }

  @returns
  {
    [id]: <Channel Id String>
  }
*/
module.exports = ({channels, peer, tokens}) => {
  const array = channels
    .filter(n => n.partner_public_key === peer)
    .filter(n => n.local_balance - n.local_reserve > tokens);

  if (!array.length) {
    return {};
  }

  const {sorted} = sortBy({array, attribute});

  const [{id}] = sorted.slice().reverse();

  return {id};
};
