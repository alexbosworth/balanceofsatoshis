const asyncAuto = require('async/auto');
const {getPayment} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {subscribeToPastPayment} = require('ln-service');

const sendMessage = require('./send_message');

const earnEmoji = '💰';
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

      // Deatils for message
      details: ['getPayment', ({getPayment}, cbk) => {
        // Exit early when the invoice has yet to be confirmed
        if (!invoice.is_confirmed) {
          return;
        }

        const {description} = invoice;
        const {received} = invoice;

        if (!getPayment) {
          return cbk(null, `Received ${received} for “${description}”`);
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
