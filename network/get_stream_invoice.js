const asyncAuto = require('async/auto');
const asyncReflect = require('async/reflect');
const asyncRetry = require('async/retry');
const {formatTokens} = require('ln-sync');
const {returnResult} = require('asyncjs-util');

const getPayRequest = require('./../lnurl/get_pay_request');

const defaultRateLimitDelayMs = 1000 * 5;
const {isArray} = Array;
const mtokensAsTokens = n => Number(BigInt(n) / BigInt(1e3));
const rateLimitAttempts = 5;
const rateLimitedError = 'ServiceRateLimitedPaymentRequest';
const serviceDeclinedError = 'ServiceReturnedError';

/** Get an invoice from a LNURL service for a payment of a stream

  {
    hash: <Description Hash Hex String>
    logger: <Winston Logger Object>
    mtokens: <Invoice Amount Millitokens String>
    [rate_limit_delay_ms]: <First Wait After Rate Limit Milliseconds Number>
    request: <Request Function>
    url: <Service Callback URL String>
  }

  @returns via cbk or Promise
  {
    [is_amount_too_high]: <Service Turned Down The Amount Bool>
    [request]: <BOLT 11 Payment Request String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.hash) {
          return cbk([400, 'ExpectedDescriptionHashToGetStreamInvoice']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToGetStreamInvoice']);
        }

        if (!args.mtokens) {
          return cbk([400, 'ExpectedMillitokensToGetStreamInvoice']);
        }

        if (!args.request) {
          return cbk([400, 'ExpectedRequestFunctionToGetStreamInvoice']);
        }

        if (!args.url) {
          return cbk([400, 'ExpectedServiceUrlToGetStreamInvoice']);
        }

        return cbk();
      },

      // The amount of the invoice to show
      amount: ['validate', ({}, cbk) => {
        const tokens = mtokensAsTokens(args.mtokens);

        return cbk(null, formatTokens({tokens}));
      }],

      // Ask the service for an invoice, waiting longer after each rate limit
      getRequest: ['amount', ({amount}, cbk) => {
        args.logger.info({requesting_invoice: amount.display});

        const delayMs = args.rate_limit_delay_ms || defaultRateLimitDelayMs;

        return asyncReflect(asyncRetry)({
          errorFilter: err => {
            // Exit early when the error is not a rate limit
            if (!isArray(err) || err[1] !== rateLimitedError) {
              return false;
            }

            args.logger.info({invoice_rate_limited: amount.display});

            return true;
          },
          interval: count => delayMs * 2 ** (count - 1),
          times: rateLimitAttempts,
        },
        cbk => {
          return getPayRequest({
            hash: args.hash,
            mtokens: args.mtokens,
            request: args.request,
            url: args.url,
          },
          cbk);
        },
        cbk);
      }],

      // Note the invoice, or that the service turned down the amount
      invoice: ['amount', 'getRequest', ({amount, getRequest}, cbk) => {
        const {error, value} = getRequest;

        // Exit early when the service declined to make the invoice: an ERROR
        // reply that is not a rate limit or an outage is taken to mean the
        // amount was too high, so a smaller amount is tried next
        if (isArray(error) && error[1] === serviceDeclinedError) {
          const [,, details] = error;

          args.logger.info({
            invoice_declined: amount.display,
            reason: details.err,
          });

          return cbk(null, {is_amount_too_high: true});
        }

        if (!!error) {
          return cbk(error);
        }

        // The request is what the route search probes towards
        args.logger.info({payment_request: value.request});

        return cbk(null, {request: value.request});
      }],
    },
    returnResult({reject, resolve, of: 'invoice'}, cbk));
  });
};
