const {join} = require('path');
const {homedir} = require('os');
const {readFile} = require('fs');

const asyncAuto = require('async/auto');
const request = require('request');
const {returnResult} = require('asyncjs-util');

const apiKeyFile = 'bitcoinaverage_api_key';
const cents = 100;
const defaultFiat = 'USD';
const {floor} = Math;
const from = 'BTC';
const home = '.bos';
const {isArray} = Array;
const known = ['GBP', 'EUR', 'MXN', 'USD'];
const msPerSec = 1e3;
const separator = ',';
const url = 'https://apiv2.bitcoinaverage.com/indices/global/ticker/short';

/** Get exchange rates

  Add an API key to ~/.bos/bitcoinaverage_api_key if hitting frequently

  {
    symbols: [<Fiat Symbol String>]
  }

  @returns via cbk
  {
    tickers: [{
      date: <Rate Updated At ISO 8601 Date String>
      rate: <Exchange Rate in Cents Number>
      ticker: <Ticker Symbol String>
    }]
  }
*/
module.exports = ({symbols}, cbk) => {
  return asyncAuto({
    // Check arguments
    validate: cbk => {
      if (!isArray(symbols)) {
        return cbk([400, 'ExpectedArrayOfDestinationSymbolsForExchangeRates']);
      }

      const unknownSymbol = symbols.find(symbol => !known.find(n => n === symbol));

      if (!!unknownSymbol) {
        return cbk([400, 'UnexpectedUnknownFiatSymbol', unknownSymbol]);
      }

      return cbk();
    },

    // Get credentials
    getCredentials: ['validate', ({}, cbk) => {
      return readFile(join(...[homedir(), home, apiKeyFile]), (err, key) => {
        // Exit early when there are no credentials
        if (!!err) {
          return cbk(null, undefined);
        }

        return cbk(null, key.toString('utf8'));
      });
    }],

    // Get tickers
    getTickers: ['getCredentials', ({getCredentials}, cbk) => {
      const toFiat = !symbols.length ? [defaultFiat] : symbols;

      return request({
        url,
        headers: {'X-ba-key': getCredentials},
        json: true,
        qs: {crypto: [from].join(separator), fiat: toFiat.join(separator)},
      },
      (err, r, res) => {
        if (!!err) {
          return cbk([503, 'UnexpectedErrorGettingExchangeRates', err]);
        }

        if (!r || !r.statusCode || !res) {
          return cbk([503, 'UnexpectedResponseFromExchangeRateProvider']);
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

        if (!!tickers.find(n => !n)) {
          return cbk([503, 'MissingTickerDataForResponse']);
        }

        return cbk(null, {tickers});
      });
    }],
  },
  returnResult({of: 'getTickers'}, cbk));
};
