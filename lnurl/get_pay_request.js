const asyncAuto = require('async/auto');
const {parsePaymentRequest} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const errorStatus = 'ERROR';

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
        const qs = {amount: mtokens};

        return request({qs, url, json: true}, (err, r, json) => {
          if (!!err) {
            return cbk([503, 'FailedToGetPaymentRequestFromService', {err}]);
          }

          if (!json) {
            return cbk([503, 'ServiceFailedToReturnPayReqJson']);
          }

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
