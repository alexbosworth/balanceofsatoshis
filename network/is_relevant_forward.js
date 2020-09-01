/** Determine if a forward is relevant

  {
    all_channels: [{
      id: <Channel Id String>
      partner_public_key: <Partner Public Key Hex String>
    }]
    [from]: <From Public Key Hex String>
    incoming_channel: <Forward Incoming Channel Id String>
    node_channels: [{
      id: <Channel Id String>
      partner_public_key: <Partner Public Key Hex String>
    }]
    outgoing_channel: <Outgoing Channel Id String>
    [to]: <To Public Key Hex String>
  }

  @returns
  <Is Relevant Bool>
*/
module.exports = args => {
  const inChannel = args.all_channels.find(channel => {
    return channel.id === args.incoming_channel;
  });

  const outChannel = args.node_channels.find(channel => {
    return channel.id === args.outgoing_channel;
  });

  if (!outChannel) {
    return false;
  }

  if (!!args.to && outChannel.partner_public_key !== args.to) {
    return false;
  }

  if (!args.from) {
    return true;
  }

  if (!inChannel) {
    return false;
  }

  return inChannel.partner_public_key === args.from;
};
