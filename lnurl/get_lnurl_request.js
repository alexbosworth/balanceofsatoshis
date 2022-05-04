const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const getPayRequest = require('./get_pay_request');
const getPayTerms = require('./get_pay_terms');
const parseUrl = require('./parse_url');

const tokensAsMtokens = tokens => (BigInt(tokens) * BigInt(1e3)).toString();

/** Get a LNURL request for a given amount

  {
    lnurl: <LNUrl String>
    request: <Request Function>
    tokens: <Tokens Payment Request String>
  }

  @returns via cbk or Promise
  {
    destination: <Destination Public Key Hex String>
    request: <BOLT 11 Payment Request String>
  }
*/
module.exports = ({lnurl, request, tokens}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        try {
          parseUrl({url: lnurl});
        } catch (err) {
          return cbk([400, err.message]);
        }

        if (!request) {
          return cbk([400, 'ExpectedRequestFunctionToGetLnurlRequest']);
        }

        if (!tokens) {
          return cbk([400, 'ExpectedTokensToGetLnurlRequest']);
        }

        return cbk();
      },

      // Parse the LNURL into a regular url
      url: ['validate', ({}, cbk) => {
        return cbk(null, parseUrl({url: lnurl}).url);
      }],

      // Get accepted terms from the encoded url
      getTerms: ['url', ({url}, cbk) => getPayTerms({request, url}, cbk)],

      // Get payment request
      getRequest: ['getTerms', ({getTerms}, cbk) => {
        if (tokens > getTerms.max) {
          return cbk([400, 'PaymentAmountAboveMaximum', {max: getTerms.max}]);
        }

        if (tokens < getTerms.min) {
          return cbk([400, 'PaymentAmountBelowMinimum', {min: getTerms.min}]);
        }

        return getPayRequest({
          request,
          hash: getTerms.hash,
          mtokens: tokensAsMtokens(tokens),
          url: getTerms.url,
        },
        cbk);
      }],
    },
    returnResult({reject, resolve, of: 'getRequest'}, cbk));
  });
};
