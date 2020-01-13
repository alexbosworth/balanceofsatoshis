const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const api = 'https://api.coindesk.com/v1/';
const centsPerDollar = 100;
const path = 'bpi/currentprice.json';
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

        if (fiat !== 'USD') {
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
          url: `${api}${path}`,
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

          const cents = body.bpi[fiat].rate_float * centsPerDollar;

          return cbk(null, {cents});
        });
      }],
    },
    returnResult({reject, resolve, of: 'getRate'}, cbk));
  });
};
