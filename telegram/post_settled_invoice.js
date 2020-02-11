const asyncAuto = require('async/auto');
const {getPayment} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {subscribeToPastPayment} = require('ln-service');

const sendMessage = require('./send_message');

const earnEmoji = '💰';
const fromKeyType = '34349339';
const messageType = '34349334';
const rebalanceEmoji = '☯️';

/** Post settled invoices

  {
    from: <Invoice From Node String>
    id: <Connected User Id Number>
    invoice: {
      description: <Invoice Description String>
      id: <Invoice Preimage Hash Hex String>
      is_confirmed: <Invoice is Settled Bool>
      received: <Received Tokens Number>
    }
    key: <Telegram API Key String>
    lnd: <Authenticated LND gRPC API Object>
    payments: [{
      [confirmed_at]: <Payment Settled At ISO 8601 Date String>
      created_at: <Payment Held Since ISO 860 Date String>
      created_height: <Payment Held Since Block Height Number>
      in_channel: <Incoming Payment Through Channel Id String>
      is_canceled: <Payment is Canceled Bool>
      is_confirmed: <Payment is Confirmed Bool>
      is_held: <Payment is Held Bool>
      messages: [{
        type: <Message Type Number String>
        value: <Raw Value Hex String>
      }]
      mtokens: <Incoming Payment Millitokens String>
      [pending_index]: <Pending Payment Channel HTLC Index Number>
      tokens: <Payment Tokens Number>
      [total_mtokens]: <Total Payment Millitokens String>
    }]
    request: <Request Function>
  }

  @returns via cbk or Promise
*/
module.exports = ({from, id, invoice, key, lnd, request}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!from) {
          return cbk([400, 'ExpectedFromNameToPostSettledInvoice']);
        }

        if (!id) {
          return cbk([400, 'ExpectedUserIdNumberToPostSettledInvoice']);
        }

        if (!invoice) {
          return cbk([400, 'ExpectedInvoiceToPostSettledInvoice']);
        }

        if (!key) {
          return cbk([400, 'ExpectedTelegramApiKeyToPostSettledInvoice']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndObjectToPostSettledInvoice']);
        }

        if (!request) {
          return cbk([400, 'ExpectedRequestFunctionToPostSettledInvoice']);
        }

        return cbk();
      },

      // Find associated payment
      getPayment: ['validate', async ({}, cbk) => {
        // Exit early when the invoice has yet to be confirmed
        if (!invoice.is_confirmed) {
          return;
        }

        try {
          return await getPayment({lnd, id: invoice.id});
        } catch (err) {
          // Ignore errors, it is expected that there is no payment found
          return;
        }
      }],

      // Details for message
      details: ['getPayment', ({getPayment}, cbk) => {
        // Exit early when the invoice has yet to be confirmed
        if (!invoice.is_confirmed) {
          return;
        }

        const {description} = invoice;
        const {payments} = invoice;
        const {received} = invoice;

        const [payment] = payments;

        const messages = !!payment ? payment.messages : [];

        const [from] = messages.filter(n => n.type === fromKeyType);
        const [message] = messages.filter(n => n.type === messageType);

        if (!getPayment) {
          const msg = !message ? '' : Buffer.from(message.value, 'hex');
          const quotedDescription = !description ? '' : `for “${description}”`;

          const receiveLine = `Received ${received} ${quotedDescription}`;
          const sender = !msg ? '' : `\nSender message: “${msg.toString()}”`;

          const replyTo = !from ? '' : `\nReply-to: ${from.value}`;

          return cbk(null, `${receiveLine}${sender}${replyTo}`);
        }

        const sub = subscribeToPastPayment({lnd, id: invoice.id});

        sub.on('confirmed', payment => {
          sub.removeAllListeners();

          return cbk(null, `Rebalanced ${received}, paid fee: ${payment.fee}`);
        });

        sub.on('error', err => cbk());

        return;
      }],

      // Post invoice
      post: ['details', 'getPayment', ({details, getPayment}, cbk) => {
        // Exit early when there is nothing to post
        if (!details) {
          return cbk();
        }

        const emoji = !getPayment ? earnEmoji : rebalanceEmoji;

        const text = `${emoji} ${from}\n${details}`;

        return sendMessage({id, key, request, text}, cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
