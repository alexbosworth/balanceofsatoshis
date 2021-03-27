const {decodeTlvStream} = require('bolt01');

const base64AsHex = base64 => Buffer.from(base64, 'base64').toString('hex');
const processAfter = () => new Date(Date.now() - (1000*60*60)).toISOString();

/** Derive key send request arguments from invoice details

  {
    [confirmed_at]: <Settled at ISO 8601 Date String>
    description: <Invoice Description String>
    [description_hash]: <Invoice Description Hash String>
    id: <Payment Hash Hex String>
    [is_canceled]: <Invoice is Canceled Bool>
    is_confirmed: <Invoice is Confirmed Bool>
    payments: [{
      is_confirmed: <HTLC is Confirmed Bool>
      messages: [{
        type: <Message Type String>
        value: <Hex Encoded Value String>
      }]
    }]
    received: <Tokens Received Rounded Down Number>
    secret: <Invoice Preimage Hex String>
    tokens: <Invoiced Tokens Rounded Down Number>
  }

  @returns
  {
    [arguments]: {
      id: <Payment Hash Hex String>
      messages: [{
        type: <Message Type String>
        value: <Hex Encoded Value String>
      }]
      received: <Tokens Received Rounded Down Number>
    }
  }
*/
module.exports = (args) => {
  const {id} = args;

  // Exit early when there is a simulated keysend invoice
  if (!args.is_canceled && args.description_hash === args.secret) {
    try {
      const encoded = base64AsHex(args.description);

      return {
        arguments: {
          id,
          messages: decodeTlvStream({encoded}).records,
          received: args.tokens,
        },
      };
    } catch (err) {
      return {};
    }
  }

  // Exit early when the invoice is not settled
  if (!args.is_confirmed) {
    return {};
  }

  // Exit early when this was confirmed too long ago
  if (args.confirmed_at < processAfter()) {
    return {};
  }

  const htlcs = args.payments.filter(n => !!n.is_confirmed);
  const {received} = args;

  // Exit early when the invoice has no confirmed HTLCs
  if (!htlcs.length) {
    return {};
  }

  const [{messages}] = htlcs;

  // Exit early when the first HTLC has no messages
  if (!messages.length) {
    return {};
  }

  return {arguments: {id, messages, received}};
};
