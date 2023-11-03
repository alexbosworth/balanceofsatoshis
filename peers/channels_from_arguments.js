const defaultChannelCapacity = 5e6;
const defaultChannelDescription = 'bos open';
const isTrusted = type => ['private-trusted', 'public-trusted'].includes(type);
const numericFeeRate = n => !!n && /^\d+$/.test(n) ? Number(n) : undefined;
const privateTypes = ['private', 'private-trusted'];
const taprootChannelType = 'taproot';
const trustedFundingTypes = ['private-trusted', 'public-trusted'];
const uniq = arr => Array.from(new Set(arr));

/** Derive channel to open details from channel argument list

  {
    addresses: [<Address String>]
    capacities: [<Channel Capacity Tokens Number>]
    channel_types: [<Channel Output Types String>]
    gives: [<Give Tokens String>]
    nodes: [<Channel Partner Node Identity Public Key Hex String>]
    rates: [<Set Fee Rate String>]
    saved: [<Open on Saved Node Name String>]
    types: [<Channel Type String>]
  }

  @returns
  {
    opens: [{
      channels: [{
        capacity: <Channel Capacity Tokens Number>
        [cooperative_close_address]: <Restrict Coop Close to Address String>
        description: <Channel Description String>
        [give_tokens]: <Give Tokens Number>
        is_private: <Channel Is Private Bool>
        is_simplified_taproot: <Channel Is Taproot Bool>
        partner_public_key: <Channel Partner Identity Public Key Hex String>
        [rate]: <Set Fee Rate String>
      }]
      [node]: <Saved Node Name String>
    }]
  }
*/
module.exports = args => {
  console.log(args)
  const channels = args.nodes.map((key, i) => {
    return {
      capacity: args.capacities[i] || defaultChannelCapacity,
      cooperative_close_address: args.addresses[i] || undefined,
      description: defaultChannelDescription,
      fee_rate: numericFeeRate(args.rates[i]),
      give_tokens: !!args.gives[i] ? Number(args.gives[i]) : undefined,
      is_private: !!args.types[i] && privateTypes.includes(args.types[i]),
      is_simplified_taproot: !!args.channel_types[i] && args.channel_types[i] == taprootChannelType ? true : false,
      is_trusted_funding: !!args.types[i] && isTrusted(args.types[i]),
      node: args.saved[i] || undefined,
      partner_public_key: key,
      rate: args.rates[i] || undefined,
    };
  });

  // Exit early when there are no saved nodes to use
  if (!args.saved.length) {
    return {opens: [{channels}]};
  }

  const opens = uniq(args.saved).map(node => {
    return {node, channels: channels.filter(n => n.node === node)};
  });

  return {opens};
};
