const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const sendMessage = require('./send_message');

/** Post settled invoices

  {
    from: <Invoice From Node String>
    id: <Connected User Id Number>
    invoice: {
      description: <Invoice Description String>
      is_confirmed: <Invoice is Settled Bool>
      received: <Received Tokens Number>
    }
    key: <Telegram API Key String>
    request: <Request Function>
  }

  @returns via cbk or Promise
*/
module.exports = ({from, id, invoice, key, request}, cbk) => {
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

        if (!request) {
          return cbk([400, 'ExpectedRequestFunctionToPostSettledInvoice']);
        }

        return cbk();
      },

      // Post invoice
      post: ['validate', ({}, cbk) => {
        // Exit early when the invoice has yet to be confirmed
        if (!invoice.is_confirmed) {
          return cbk();
        }

        const {description} = invoice;
        const {received} = invoice;

        return sendMessage({
          id,
          key,
          request,
          text: `💰 ${from}\n- Received ${received} for “${description}”`,
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
