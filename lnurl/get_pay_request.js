const asyncAuto = require('async/auto');
const {parsePaymentRequest} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const errorStatus = 'ERROR';
const isRateLimited = res => !!res && res.statusCode === 429;
const isServerFailure = res => !!res && res.statusCode >= 500;
const timeoutMs = 1000 * 60;

/** Get a payment request for a LNURL

  {
    hash: <Hash Hex String>
    mtokens: <Millitokens For Payment Request String>
    request: <Request Function>
    url: <URL String>
  }

  @returns via cbk or Promise
  {
    destination: <Destination Public Key Hex String>
    request: <BOLT 11 Payment Request String>
  }
*/
module.exports = ({hash, mtokens, request, url}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!hash) {
          return cbk([400, 'ExpectedDescriptionHashToGetLnurlPayRequest']);
        }

        if (!mtokens) {
          return cbk([400, 'ExpectedMillitokensToGetLnurlPayRequest']);
        }

        if (!request) {
          return cbk([400, 'ExpectedRequestFunctionToGetLnurlPayRequest']);
        }

        if (!url) {
          return cbk([400, 'ExpectedUrlToGetLnurlPayRequest']);
        }

        return cbk();
      },

      // Get the payment request
      getRequest: ['validate', ({}, cbk) => {
        return request({
          url,
          json: true,
          qs: {amount: mtokens},
          timeout: timeoutMs,
        },
        (err, r, json) => {
          if (!!err) {
            return cbk([503, 'FailedToGetPaymentRequestFromService', {err}]);
          }

          if (!json) {
            return cbk([503, 'ServiceFailedToReturnPayReqJson']);
          }

          // A rate limit is a temporary failure, not a refusal of the request
          if (json.status === errorStatus && isRateLimited(r)) {
            return cbk([503, 'ServiceRateLimitedPaymentRequest', {
              err: json.reason,
            }]);
          }

          // A server failure is an outage, not a refusal of the request
          if (json.status === errorStatus && isServerFailure(r)) {
            return cbk([503, 'ServiceFailedToMakePaymentRequest', {
              err: json.reason,
            }]);
          }

          // LNURL errors carry no codes and services turn down requests with
          // any other status, like 200 or 400, so those are taken as refusals
          if (json.status === errorStatus) {
            return cbk([503, 'ServiceReturnedError', {err: json.reason}]);
          }

          if (!json.pr) {
            return cbk([503, 'ExpectedPaymentRequestFromService']);
          }

          try {
            parsePaymentRequest({request: json.pr});
          } catch (err) {
            return cbk([503, 'FailedToParseReturnedPaymentRequest', {err}]);
          }

          const request = parsePaymentRequest({request: json.pr});

          if (request.description_hash !== hash) {
            return cbk([503, 'ServiceReturnedInvalidPaymentDescriptionHash']);
          }

          if (request.is_expired) {
            return cbk([503, 'ServiceReturnedExpiredPaymentRequest']);
          }

          if (request.mtokens !== mtokens) {
            return cbk([503, 'ServiceReturnedIncorrectInvoiceAmount']);
          }

          return cbk(null, {
            destination: request.destination,
            request: json.pr,
          });
        });
      }],
    },
    returnResult({reject, resolve, of: 'getRequest'}, cbk));
  });
};
