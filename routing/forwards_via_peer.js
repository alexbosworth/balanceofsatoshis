const notFound = -1;
const uniq = arr => Array.from(new Set(arr));

/** Filter out forwards via a peer

  {
    forwards: [{
      created_at: <Forward Record Created At ISO 8601 Date String>
      fee: <Fee Tokens Charged Number>
      fee_mtokens: <Approximated Fee Millitokens Charged String>
      incoming_channel: <Incoming Standard Format Channel Id String>
      [mtokens]: <Forwarded Millitokens String>
      outgoing_channel: <Outgoing Standard Format Channel Id String>
      tokens: <Forwarded Tokens Number>
    }]
    private_channels: [{
      [id]: <Private Channel Id String>
      partner_public_key: <Partner Public Key Hex String>
    }]
    public_channels: [{
      [id]: <Public Channel Id String>
    }]
    via: <Via Peer With Public Key Hex String>
  }

  @returns
  {
    forwards: [{
      created_at: <Forward Record Created At ISO 8601 Date String>
      fee: <Fee Tokens Charged Number>
      fee_mtokens: <Approximated Fee Millitokens Charged String>
      incoming_channel: <Incoming Standard Format Channel Id String>
      [mtokens]: <Forwarded Millitokens String>
      outgoing_channel: <Outgoing Standard Format Channel Id String>
      tokens: <Forwarded Tokens Number>
    }]
  }
*/
module.exports = args => {
  const privateChans = args.private_channels
    .filter(channel => channel.partner_public_key === args.via)
    .map(({id}) => id);

  const publicChans = args.public_channels.map(({id}) => id);

  const channelIds = uniq([].concat(privateChans).concat(publicChans));

  const forwards = args.forwards.filter(forward => {
    if (channelIds.indexOf(forward.incoming_channel) !== notFound) {
      return true;
    }

    if (channelIds.indexOf(forward.outgoing_channel) !== notFound) {
      return true;
    }

    return false;
  });

  return {forwards};
};
