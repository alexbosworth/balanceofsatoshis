const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const api = 'https://api.coinbase.com/';
const centsPerUnit = 100;
const {round} = Math;
const supportedFiats = ['EUR', 'USD'];

/** Get the number of cents for a Bitcoin from Coinbase

  {
    currency: <Currency String>
    fiat: <Fiat String>
    request: <Request Function>
  }

  @returns via cbk or Promise
  {
    cents: <Cents Per Token Number>
    date: <Updated At ISO 8601 Date String>
  }
*/
module.exports = ({currency, fiat, request}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (currency !== 'BTC') {
          return cbk([400, 'ExpectedCurrencyCodeToGetCoinbaseCurrentPrice']);
        }

        if (!supportedFiats.includes(fiat)) {
          return cbk([400, 'ExpectedKnownCurrencyToGetCoinbaseCurrentPrice']);
        }

        if (!request) {
          return cbk([400, 'ExpectedRequestMethodToGetCoinbaseCurrentPrice']);
        }

        return cbk();
      },

      // Get the price data
      getRate: ['validate', ({}, cbk) => {
        return request({
          json: true,
          url: `${api}v2/prices/${currency}-${fiat}/spot`,
        },
        (err, r, body) => {
          if (!!err) {
            return cbk([503, 'UnexpectedErrorGettingCoinbasePrice', err]);
          }

          if (!body || !body.data || !body.data.amount) {
            return cbk([503, 'ExpectedCurrencyRateDataFromCoinbase']);
          }

          const cents = round(body.data.amount * centsPerUnit);

          return cbk(null, {cents, date: new Date().toISOString()});
        });
      }],
    },
    returnResult({reject, resolve, of: 'getRate'}, cbk));
  });
};

