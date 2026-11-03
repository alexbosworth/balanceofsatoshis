const asyncAuto = require('async/auto');
const asyncReflect = require('async/reflect');
const {formatTokens} = require('ln-sync');
const {returnResult} = require('asyncjs-util');

const getPayRequest = require('./../lnurl/get_pay_request');

const {isArray} = Array;
const mtokensAsTokens = n => Number(BigInt(n) / BigInt(1e3));
const serviceDeclinedError = 'ServiceReturnedError';

/** Get an invoice from a LNURL service for a payment of a stream

  {
    hash: <Description Hash Hex String>
    logger: <Winston Logger Object>
    mtokens: <Invoice Amount Millitokens String>
    request: <Request Function>
    url: <Service Callback URL String>
  }

  @returns via cbk or Promise
  {
    [is_amount_too_high]: <Service Turned Down The Amount Bool>
    [request]: <BOLT 11 Payment Request String>
  }
*/
module.exports = ({hash, logger, mtokens, request, url}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!hash) {
          return cbk([400, 'ExpectedDescriptionHashToGetStreamInvoice']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedLoggerToGetStreamInvoice']);
        }

        if (!mtokens) {
          return cbk([400, 'ExpectedMillitokensToGetStreamInvoice']);
        }

        if (!request) {
          return cbk([400, 'ExpectedRequestFunctionToGetStreamInvoice']);
        }

        if (!url) {
          return cbk([400, 'ExpectedServiceUrlToGetStreamInvoice']);
        }

        return cbk();
      },

      // The amount of the invoice to show
      amount: ['validate', ({}, cbk) => {
        return cbk(null, formatTokens({tokens: mtokensAsTokens(mtokens)}));
      }],

      // Ask the service for an invoice
      getRequest: ['amount', ({amount}, cbk) => {
        logger.info({requesting_invoice: amount.display});

        const pay = {hash, mtokens, request, url};

        return asyncReflect(getPayRequest)(pay, cbk);
      }],

      // Note the invoice, or that the service turned down the amount
      invoice: ['amount', 'getRequest', ({amount, getRequest}, cbk) => {
        const {error, value} = getRequest;

        // Exit early when the service declined to make the invoice
        if (isArray(error) && error[1] === serviceDeclinedError) {
          const [,, details] = error;

          logger.info({invoice_declined: amount.display, reason: details.err});

          return cbk(null, {is_amount_too_high: true});
        }

        if (!!error) {
          return cbk(error);
        }

        // The request is what the route search probes towards
        logger.info({payment_request: value.request});

        return cbk(null, {request: value.request});
      }],
    },
    returnResult({reject, resolve, of: 'invoice'}, cbk));
  });
};
