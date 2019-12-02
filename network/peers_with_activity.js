const noTok = 0;

/** Peers with activity

  {
    additions: [<Add Peer Public Key Hex String>]
    channels: [{
      [id]: <Standard Format Channel Id String>
      local_balance: <Local Balance Tokens Number>
      partner_public_key: <Public Key Hex String>
      remote_balance: <Remote Balance Tokens Number>
    }]
    forwards: [{
      outgoing_channel: <Outgoing Channel Id String>
      tokens: <Forwarded Tokens Number>
    }]
    terminated: [{
      [id]: <Standard Format Channel Id String>
      partner_public_key: <Peer Pubic Key Hex String>
    }]
  }

  @returns
  {
    peers: [{
      forwarded: <Forwarded Tokens Number>
      inbound: <Inbound Tokens Balance Number>
      outbound: <Outbound Tokens Balance Number>
      public: <Public Key Hex String>
    }]
  }
*/
module.exports = ({additions, channels, forwards, terminated}) => {
  const peerSet = new Set(additions);

  const peerKeys = Array.from(
    channels.reduce((sum, n) => sum.add(n.partner_public_key), peerSet)
  );

  const peers = peerKeys.map(publicKey => {
    const active = channels.filter(n => n.partner_public_key === publicKey);

    const inbound = active.reduce((sum, n) => sum + n.remote_balance, noTok);
    const outbound = active.reduce((sum, n) => sum + n.local_balance, noTok);

    const prevOut = terminated
      .filter(n => !!n.id && n.partner_public_key === publicKey)
      .reduce((sent, {id}) => {
        return sent + forwards
          .filter(forward => forward.outgoing_channel === id)
          .reduce((sum, {tokens}) => sum + tokens, noTok);
      }, noTok);

    const forwarded = prevOut + active.reduce((sent, {id}) => {
      return sent + forwards
        .filter(forward => forward.outgoing_channel === id)
        .reduce((sum, {tokens}) => sum + tokens, noTok);
    }, noTok);

    return {forwarded, inbound, outbound, public_key: publicKey};
  });

  return {peers};
};
