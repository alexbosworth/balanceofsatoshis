/** Determine if a source of a forward is relevant

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
  const inChannel = args.node_channels.find(chan => {
    return args.incoming_channel === chan.id;
  });

  const outChannel = args.all_channels.find(chan => {
    return args.outgoing_channel === chan.id
  });

  if (!inChannel) {
    return false;
  }

  if (!!args.from && inChannel.partner_public_key !== args.from) {
    return false;
  }

  if (!args.to) {
    return true;
  }

  if (!outChannel) {
    return false;
  }

  return outChannel.partner_public_key === args.to;
};
