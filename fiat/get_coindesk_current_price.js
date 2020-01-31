const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const api = 'https://api.coindesk.com/v1/';
const centsPerDollar = 100;
const extension = '.json';
const known = ['AUD', 'CAD', 'CHF', 'EUR', 'GBP', 'JPY', 'MXN', 'USD', 'ZAR'];
const notFoundIndex = -1;
const path = 'bpi/currentprice/';
const remoteServiceTimeoutMs = 1000 * 30;

/** Get the number of cents for a big unit token from coindesk

  {
    currency: <Currency Type String>
    fiat: <Fiat Type String>
    request: <Request Function>
  }

  @returns via cbk or Promise
  {
    cents: <Cents Per Token Number>
    date: <Updated At ISO 8601 Date String>
  }
*/
module.exports = ({currency, date, fiat, request}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (currency !== 'BTC') {
          return cbk([400, 'UnsupportedCurrencyForCoindeskFiatRateLookup']);
        }

        if (known.indexOf(fiat) === notFoundIndex) {
          return cbk([400, 'UnsupportedFiatTypeForCoindeskFiatRateLookup']);
        }

        if (!request) {
          return cbk([400, 'ExpectedRequestMethodForCoindeskFiatRateLookup']);
        }

        return cbk();
      },

      // Get rate
      getRate: ['validate', ({}, cbk) => {
        return request({
          json: true,
          timeout: remoteServiceTimeoutMs,
          url: `${api}${path}${fiat}${extension}`,
        },
        (err, r, body) => {
          if (!!err) {
            return cbk([503, 'UnexpectedErrorGettingCoindeskPrice', {err}]);
          }

          if (!body || !body.bpi || !body.bpi[fiat]) {
            return cbk([503, 'UnexpectedResponseInCoindeskRateResponse']);
          }

          if (!body.bpi[fiat].rate_float) {
            return cbk([503, 'ExpectedRateForFiatInCoindeskRateResponse']);
          }

          if (!body.time || !body.time.updatedISO) {
            return cbk([503, 'ExpectedUpdatedTimeInCoindeskRateResponse']);
          }

          const cents = body.bpi[fiat].rate_float * centsPerDollar;
          const date = new Date(body.time.updatedISO).toISOString();

          return cbk(null, {cents, date});
        });
      }],
    },
    returnResult({reject, resolve, of: 'getRate'}, cbk));
  });
};
