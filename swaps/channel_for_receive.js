const {sortBy} = require('./../arrays');

const attribute = 'receivable';
const feeBuffer = fees => fees * 2;
const {floor} = Math;
const htlcOutputSize = 43;
const {min} = Math;
const mtokensAsTokens = mtokens => Number(BigInt(mtokens) / BigInt(1e3));
const rate = n => n.commit_transaction_fee / (n.commit_transaction_weight / 4);

/** Choose a channel with a peer to receive a payment through

  The peer forwards the payment to us over the channel, so the peer needs the
  balance on their side to send it and their policy towards us must allow it.

  The preferred channel is kept when it can receive the full amount, otherwise
  the channel that can receive the most is chosen.

  {
    channels: [{
      commit_transaction_fee: <Commit Transaction Fee Number>
      commit_transaction_weight: <Commit Transaction Weight Number>
      id: <Standard Format Channel Id String>
      is_active: <Channel Active Bool>
      is_partner_initiated: <Channel Partner Opened Channel Bool>
      partner_public_key: <Peer Public Key Hex String>
      policies: [{
        [is_disabled]: <Channel Is Disabled Bool>
        [max_htlc_mtokens]: <Maximum HTLC Millitokens Value String>
        public_key: <Node Public Key Hex String>
      }]
      remote_balance: <Remote Balance Tokens Number>
      remote_reserve: <Remote Reserved Tokens Number>
    }]
    [id]: <Preferred Channel Id String>
    peer: <Peer Public Key Hex String>
    tokens: <Tokens To Receive Number>
  }

  @returns
  {
    [id]: <Channel Id String>
    [receivable]: <Receivable Tokens Number>
  }
*/
module.exports = ({channels, id, peer, tokens}) => {
  const candidates = channels
    .filter(n => n.partner_public_key === peer)
    .filter(n => !!n.is_active)
    .map(channel => {
      const policy = channel.policies.find(n => n.public_key === peer);

      // Exit early when the peer does not forward to us over this channel
      if (!policy || !!policy.is_disabled) {
        return;
      }

      // The partner needs to keep a buffer for fees when they pay for commits
      const fees = !channel.is_partner_initiated ? Number() :
        channel.commit_transaction_fee + htlcOutputSize * rate(channel);

      const balance = channel.remote_balance - channel.remote_reserve;

      const spendable = balance - feeBuffer(fees);

      // The peer limits the size of HTLCs that they will forward to us
      const maxHtlc = !policy.max_htlc_mtokens ? spendable :
        mtokensAsTokens(policy.max_htlc_mtokens);

      return {id: channel.id, receivable: floor(min(spendable, maxHtlc))};
    })
    .filter(n => !!n && n.receivable > Number());

  const preferred = candidates.find(n => n.id === id);

  // Exit early when the preferred channel can receive the full amount
  if (!!preferred && preferred.receivable >= tokens) {
    return {id, receivable: preferred.receivable};
  }

  // Exit early when no channel with the peer can receive anything
  if (!candidates.length) {
    return {};
  }

  const {sorted} = sortBy({attribute, array: candidates});

  const [best] = sorted.slice().reverse();

  return {id: best.id, receivable: best.receivable};
};
