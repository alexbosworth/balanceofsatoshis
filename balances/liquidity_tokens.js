const {percentile} = require('stats-lite');

const {round} = Math;
const topPercentile = 0.9;

/** Liquidity tokens

  {
    channels: [{
      is_active: <Channel is Active Bool>
      local_balance: <Local Balance Tokens Number>
      partner_public_key: <Public Key Hex String>
      remote_balance: <Remote Balance Tokens Number>
    }]
    [is_outbound]: <Count Outbound Liquidity Bool>
    [is_top]: <Return Top Liquidity Bool>
    [max_fee_rate]: <Eliminate Inbound Liquidity With Fee Rate Above Number>
    [min_node_score]: <Eliminate Liquidity With Score Below Score Number>
    [nodes]: [{
      public_key: <Public Key Hex String>
      score: <Node Score Number>
    }]
    policies: [[{
      fee_rate: <Fee Rate Parts Per Million Number>
      public_key: <Public Key Hex String>
    }]]
    public_key: <Public Key Hex String>
    with: <With Public Key Hex String>
  }

  @returns
  [<Tokens Number>]
*/
module.exports = args => {
  const inboundFeeRates = args.policies.reduce((sum, policies) => {
    const peer = policies.find(n => n.public_key !== args.public_key);

    // Exit early when there is no known peer policy
    if (!peer) {
      return sum;
    }

    // Exit early when there is an existing higher fee rate
    if (!!sum[peer.public_key] && peer.fee_rate > sum[peer.public_key]) {
      return sum;
    }

    sum[peer.public_key] = peer.fee_rate;

    return sum;
  },
  {});

  const activeChannels = args.channels
    .filter(n => !!n.is_active)
    .filter(n => !args.with || n.partner_public_key === args.with)
    .filter(n => {
      // Exit early when considering outbound liquidity
      if (!!args.is_outbound) {
        return true;
      }

      // Exit early when there is no max fee rate
      if (args.max_fee_rate === undefined) {
        return true;
      }

      const feeRate = inboundFeeRates[n.partner_public_key];

      return !!feeRate && feeRate <= args.max_fee_rate;
    })
    .filter(channel => {
      // Exit early when there is no node score restriction
      if (!args.min_node_score) {
        return true;
      }

      const peerPublicKey = channel.partner_public_key;

      const node = args.nodes.find(n => n.public_key === peerPublicKey);

      return !!node && node.score >= args.min_node_score;
    });

  const balanceType = !!args.is_outbound ? 'local' : 'remote';

  const tokens = activeChannels.map(n => n[`${balanceType}_balance`]);

  if (!!args.is_top) {
    return [round(percentile(tokens, topPercentile))];
  }

  return tokens;
};
