const asyncAuto = require('async/auto');
const {decodeTlvStream} = require('bolt01');
const {getInvoices} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {subscribeToInvoices} = require('ln-service');

const keySendRequestArguments = require('./key_send_request_arguments');
const respondToKeySendRequest = require('./respond_to_key_send_request');

const nodeName = (alias, key) => `${alias} ${key}`.trim();

/** Service keysend services requests

  {
    lnd: <Server Authenticated LND API Object>
    logger: <Winston Logger Object>
    pay: <Payer Authenticated LND API Object>
  }

  @returns via cbk or Promise
*/
module.exports = ({lnd, logger, pay}, cbk) => {
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

        if (!pay) {
          return cbk([400, 'ExpectedPayerLndToServiceKeySendRequests']);
        }

        return cbk();
      },

      // Get serving node
      getServer: ['validate', ({}, cbk) => getWalletInfo({lnd}, cbk)],

      // Get payer info
      getPayer: ['validate', ({}, cbk) => getWalletInfo({lnd: pay}, cbk)],

      // Listen for service requests
      listen: ['getPayer', 'getServer', ({getPayer, getServer}, cbk) => {
        const sub = subscribeToInvoices({lnd});

        // Stop service when there is an error with the connection
        sub.on('error', err => cbk(err));

        logger.info({
          serving_keysend_requests: [{
            type: 'ping',
            description: 'Send back ping payment requests with a pong payment',
            serving_from: nodeName(getServer.alias, getServer.public_key),
            paying_from: nodeName(getPayer.alias, getPayer.public_key),
          }],
        });

        const process = async invoice => {
          const {arguments} = keySendRequestArguments({
            confirmed_at: invoice.confirmed_at,
            description: invoice.description,
            description_hash: invoice.description_hash,
            id: invoice.id,
            is_canceled: invoice.is_canceled,
            is_confirmed: invoice.is_confirmed,
            payments: invoice.payments,
            received: invoice.received,
            secret: invoice.secret,
            tokens: invoice.tokens,
          });

          if (!arguments) {
            return;
          }

          try {
            return await respondToKeySendRequest({
              lnd,
              logger,
              pay,
              id: arguments.id,
              messages: arguments.messages,
              received: arguments.received,
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
