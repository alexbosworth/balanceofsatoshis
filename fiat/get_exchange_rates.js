const {join} = require('path');
const {homedir} = require('os');
const {readFile} = require('fs');

const asyncAuto = require('async/auto');
const defaultRequest = require('request');
const {returnResult} = require('asyncjs-util');

const apiKeyFile = 'bitcoinaverage_api_key';
const cents = 100;
const contains = (arr, element) => arr.indexOf(element) !== -1;
const defaultFiat = 'USD';
const {floor} = Math;
const from = 'BTC';
const home = '.bos';
const {isArray} = Array;
const known = ['AUD', 'CAD', 'CHF', 'GBP', 'EUR', 'JPY', 'MXN', 'USD', 'ZAR'];
const msPerSec = 1e3;
const separator = ',';
const url = 'https://apiv2.bitcoinaverage.com/indices/global/ticker/short';

/** Get exchange rates

  Add an API key to ~/.bos/bitcoinaverage_api_key if hitting frequently

  {
    [read]: <Read File Function> path, (err, file) => {}
    [request]: <Request Function> {url}, (err, {statusCode}, body) => {}
    symbols: [<Fiat Symbol String>] // empty defaults to USD
  }

  @returns via cbk or Promise
  {
    tickers: [{
      date: <Rate Updated At ISO 8601 Date String>
      rate: <Exchange Rate in Cents Number>
      ticker: <Ticker Symbol String>
    }]
  }
*/
module.exports = ({read, request, symbols}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isArray(symbols)) {
          return cbk([400, 'ExpectedArrayOfFiatSymbolsForExchangeRates']);
        }

        const unknown = symbols.find(symbol => !known.find(n => n === symbol));

        if (!!unknown) {
          return cbk([400, 'UnexpectedUnknownFiatSymbol', {unknown}]);
        }

        return cbk();
      },

      // Get credentials
      getCredentials: ['validate', ({}, cbk) => {
        const reader = read || readFile;

        return reader(join(...[homedir(), home, apiKeyFile]), (err, key) => {
          // Exit early when there are no credentials
          if (!!err || !key) {
            return cbk(null, undefined);
          }

          return cbk(null, key.toString('utf8'));
        });
      }],

      // Get tickers
      getTickers: ['getCredentials', ({getCredentials}, cbk) => {
        const requestMethod = request || defaultRequest;
        const toFiat = !symbols.length ? [defaultFiat] : symbols;

        return requestMethod({
          url,
          headers: {'X-ba-key': getCredentials},
          json: true,
          qs: {crypto: [from].join(separator), fiat: toFiat.join(separator)},
        },
        (err, r, res) => {
          if (!!err) {
            return cbk([503, 'UnexpectedErrorGettingExchangeRates', {err}]);
          }

          if (!r) {
            return cbk([503, 'UnexpectedResponseFromExchangeRateProvider']);
          }

          if (r.statusCode !== 200) {
            return cbk([503, 'UnexpectedStatusCodeFromExchangeRateProvider']);
          }

          if (!res) {
            return cbk([503, 'ExpectedNonEmptyResponseFromRateProvider']);
          }

          const tickers = toFiat.sort().map(to => {
            const rates = res[`${from}${to}`];

            if (!rates || !rates.last || !rates.timestamp) {
              return null;
            }

            return {
              date: new Date(rates.timestamp * msPerSec).toISOString(),
              rate: floor(rates.last * cents),
              ticker: to,
            };
          });

          if (contains(tickers, null)) {
            return cbk([503, 'MissingTickerDataForResponse']);
          }

          return cbk(null, {tickers});
        });
      }],
    },
    returnResult({reject, resolve, of: 'getTickers'}, cbk));
  });
};
