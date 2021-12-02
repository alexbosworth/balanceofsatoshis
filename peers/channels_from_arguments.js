const defaultChannelCapacity = 5e6;

/** Derive channel to open details from channel argument list

  {
    addresses: [<Address String>]
    capacities: [<Channel Capacity Tokens Number>]
    gives: [<Give Tokens String>]
    nodes: [<Node Identity Public Key Hex String>]
    types: [<Channel Type String>]
  }

  @returns
  {
    channels: [{
      capacity: <Channel Capacity Tokens Number>
      [give_tokens]: <Give Tokens Number>
      is_private: <Channel Is Private Bool>
      partner_public_key: <Channel Partner Identity Public Key Hex String>
    }]
  }
*/
module.exports = ({addresses, capacities, gives, nodes, types}) => {
  const channels = nodes.map((key, i) => {
    const type = types[i] || undefined;

    return {
      capacity: capacities[i] || defaultChannelCapacity,
      cooperative_close_address: !!addresses[i] ? addresses[i] : undefined,
      give_tokens: !!gives[i] ? Number(gives[i]) : undefined,
      is_private: !!type && type === 'private',
      partner_public_key: key,
    };
  });

  return {channels};
};
