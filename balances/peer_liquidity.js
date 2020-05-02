/** Calculate peer liquidity

  {
    channels: [{
      local_balance: <Local Balance Tokens Number>
      pending_payments: [{
        id: <Payment Hash Hex String>
        is_outgoing: <Payment is Outgoing Bool>
        tokens: <Payment Tokens Number>
      }]
      remote_balance: <Remote Balance Tokens Number>
    }]
    opening: [{
      local_balance: <Local Balance Tokens Number>
      remote_balance: <Remote Balance Tokens Number>
    }]
    [settled]: <Known Settled Payment Id Hex String>
  }

  @returns
  {
    inbound: <Inbound Liquidity Tokens Number>
    inbound_opening: <Opening Inbound Liquidity Tokens Number>
    inbound_pending: <Pending Inbound Liquidity Tokens Number>
    outbound: <Outbound Liquidity Tokens Number>
    outbound_opening: <Opening Outbound Liquidity Tokens Number>
    outbound_pending: <Pending Outbound Liquidity Tokens Number>
  }
*/
module.exports = ({channels, opening, settled}) => {
  // Inbound is the sum of remote balances
  const inbound = channels.reduce((sum, channel) => {
    // Settled payment is known so it can be considered part of remote balance
    const settledBalance = channel.pending_payments
      .filter(n => n.id === settled)
      .map(n => n.is_outgoing ? n.tokens : Number())
      .reduce((sum, n) => sum + n, Number());

    return sum + channel.remote_balance + settledBalance;
  },
  Number());

  // Outbound is the sum of local balances
  const outbound = channels.reduce((sum, channel) => {
    // Settled payment is known so it can be considered part of local balance
    const settledBalance = channel.pending_payments
      .filter(n => n.id === settled)
      .map(n => !n.is_outgoing ? n.tokens : Number())
      .reduce((sum, n) => sum + n, Number());

    return sum + channel.local_balance + settledBalance;
  },
  Number());

  // Pending inbound is potential remote balance amount assuming HTLCs succeed
  const pendingInbound = channels.reduce((allPending, channel) => {
    return allPending + channel.pending_payments
      .filter(n => n.id !== settled && !!n.is_outgoing)
      .reduce((sum, n) => sum + n.tokens, Number());
  },
  Number());

  // Pending outbound is the potential local amount assuming HTLCs succeed
  const pendingOutbound = channels.reduce((allPending, channel) => {
    return allPending + channel.pending_payments
      .filter(n => n.id !== settled && !n.is_outgoing)
      .reduce((sum, n) => sum + n.tokens, Number());
  },
  Number());

  // How much remote balance is in channels opening towards us?
  const openIn = opening.reduce((sum, n) => sum + n.remote_balance, Number());

  // How much local balance is in channels opening outwards?
  const openOut = opening.reduce((sum, n) => sum + n.local_balance, Number());

  return {
    inbound,
    outbound,
    inbound_opening: openIn,
    inbound_pending: pendingInbound,
    outbound_opening: openOut,
    outbound_pending: pendingOutbound,
  };
};
