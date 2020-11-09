const asyncAuto = require('async/auto');
const {getInvoices} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {subscribeToInvoices} = require('ln-service');

const respondToKeySendRequest = require('./respond_to_key_send_request');

/** Service keysend services requests

  {
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
  }

  @returns via cbk or Promise
*/
module.exports = ({lnd, logger}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedLndToServiceKeySendRequests']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedLoggerToServiceKeySendRequests']);
        }

        return cbk();
      },

      // Listen for service requests
      listen: ['validate', ({}, cbk) => {
        const sub = subscribeToInvoices({lnd});

        // Stop service when there is an error with the connection
        sub.on('error', err => cbk(err));

        logger.info({
          serving_keysend_requests: [{
            type: 'ping',
            description: 'Send back ping payment requests with a pong payment',
          }],
        });

        const process = async invoice => {
          // Exit early when the invoice is not settled
          if (!invoice.is_confirmed) {
            return;
          }

          const htlcs = invoice.payments.filter(n => !!n.is_confirmed);
          const {id} = invoice;
          const {received} = invoice;

          // Exit early when the invoice has no confirmed HTLCs
          if (!htlcs.length) {
            return;
          }

          // Exit early when the first HTLC has no
          const [{messages}] = htlcs;

          if (!messages.length) {
            return;
          }

          try {
            return await respondToKeySendRequest({
              id,
              lnd,
              logger,
              messages,
              received,
            });
          } catch (err) {
            return logger.error({err});
          }
        };

        getInvoices({lnd}, (err, res) => {
          if (!!err) {
            return logger.error({err});
          }

          return res.invoices.forEach(invoice => process(invoice));
        });

        sub.on('invoice_updated', invoice => process(invoice));

        return;
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
