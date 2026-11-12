const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');
const {subscribeToInvoice} = require('ln-service');

/** Wait for an invoice to have its payment held

  {
    id: <Invoice Payment Hash Hex String>
    lnd: <Authenticated LND API Object>
  }

  @returns via cbk or Promise
*/
module.exports = ({id, lnd}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!id) {
          return cbk([400, 'ExpectedInvoiceIdToWaitForHeldInvoice']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndToWaitForHeldInvoice']);
        }

        return cbk();
      },

      // Wait for the invoice payment to be held
      wait: ['validate', ({}, cbk) => {
        const sub = subscribeToInvoice({id, lnd});

        const done = err => {
          sub.removeAllListeners();

          return cbk(err);
        };

        sub.on('error', err => done([503, 'InvoiceSubscribeFailed', {err}]));

        sub.on('invoice_updated', invoice => {
          // Exit early when the invoice was canceled
          if (!!invoice.is_canceled) {
            return done([400, 'InvoiceCanceledBeforePaymentHeld']);
          }

          // Exit early when the payment is not held yet
          if (!invoice.is_held) {
            return;
          }

          return done();
        });
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
