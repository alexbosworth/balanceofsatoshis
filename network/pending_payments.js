const flatten = arr => [].concat(...arr);

/** Derive pending forwarding and sending HTLCs from channels

  {
    channels: [{
      id: <Channel Id String>
      partner_public_key: <Peer Public Key Hex String>
      pending_payments: [{
        id: <Payment Preimage Hash Hex String>
        [in_channel]: <Forward Inbound From Channel Id String>
        [in_payment]: <Payment Index on Inbound Channel Number>
        [is_forward]: <Payment is a Forward Bool>
        is_outgoing: <Payment Is Outgoing Bool>
        [out_channel]: <Forward Outbound To Channel Id String>
        [out_payment]: <Payment Index on Outbound Channel Number>
        [payment]: <Payment Attempt Id Number>
        timeout: <Chain Height Expiration Number>
        tokens: <Payment Tokens Number>
      }]
    }]
  }

  @returns
  {
    forwarding: [{
      fee: <Routing Fee Tokens Number>
      in_peer: <Forwarding From Peer Public Key Hex String>
      out_peer: <Forwarding To Peer Public Key Hex String>
      payment: <Forwarding Payment Hash Hex String>
      timeout: <Chain Height Expiration Number>
      tokens: <Forwarding Tokens Amount Number>
    }]
    sending: [{
      id: <Sending Payment Hash Hex String>
      out_channel: <Sending Out Channel Id String>
      out_peer: <Sending Out Peer Public Key Hex String>
      timeout: <Sending Timeout Block Height Number>
      tokens: <Sending Tokens Amount Number>
    }]
  }
*/
module.exports = ({channels}) => {
  // Outgoing HTLCs that are not forwards are payments or probes being sent
  const sending = flatten(channels.map(channel => {
    return channel.pending_payments
      .filter(n => !n.is_forward && !!n.is_outgoing)
      .map(payment => ({
        id: payment.id,
        out_channel: channel.id,
        out_peer: channel.partner_public_key,
        timeout: payment.timeout,
        tokens: payment.tokens,
      }));
  }));

  // Outgoing forward HTLCs reference the inbound HTLC that they are relaying
  const outbound = flatten(channels.map(channel => {
    return channel.pending_payments
      .filter(n => !!n.is_forward && !!n.is_outgoing && !!n.in_channel)
      .map(payment => ({
        id: payment.id,
        in_channel: payment.in_channel,
        in_payment: payment.in_payment,
        out_channel: channel.id,
        out_peer: channel.partner_public_key,
        tokens: payment.tokens,
      }));
  }));

  // Pair up outgoing forward HTLCs with the inbound HTLCs they are relaying
  const forwarding = outbound.map(htlc => {
    const inboundChannel = channels.find(n => n.id === htlc.in_channel);

    // Exit early when the inbound channel is not a known channel
    if (!inboundChannel) {
      return;
    }

    // The inbound HTLC is the one forwarding to the outbound channel
    const inbound = inboundChannel.pending_payments.find(payment => {
      const isForwardIn = !payment.is_outgoing && !!payment.is_forward;
      const isSameIndex = payment.payment === htlc.in_payment;
      const isToOutChannel = payment.out_channel === htlc.out_channel;

      return isForwardIn && isToOutChannel && isSameIndex;
    });

    // Exit early when the inbound HTLC is not present on the inbound channel
    if (!inbound) {
      return;
    }

    return {
      fee: inbound.tokens - htlc.tokens,
      in_peer: inboundChannel.partner_public_key,
      out_peer: htlc.out_peer,
      payment: htlc.id,
      timeout: inbound.timeout,
      tokens: htlc.tokens,
    };
  });

  return {sending, forwarding: forwarding.filter(n => !!n)};
};
