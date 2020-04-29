const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const api = 'https://api.coingecko.com/api/v3/exchange_rates';
const centsPerDollar = 100;
const currency = 'BTC';
const defaultFiat = 'USD';
const {isArray} = Array;
const remoteServiceTimeoutMs = 1000 * 30;

/** Get exchange rates from CoinGecko

  {
    request: <Request Function> {url}, (err, {statusCode}, body) => {}
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
module.exports = ({request, symbols}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!request) {
          return cbk([400, 'ExpectedRequestFunctionToGetExchangeRates']);
        }

        if (!isArray(symbols)) {
          return cbk([400, 'ExpectedSymbolsToGetCoingeckoExchangeRates']);
        }

        return cbk();
      },

      // Fetch all the prices
      getPrices: ['validate', ({}, cbk) => {
        if (!symbols.length) {
          symbols.push(defaultFiat);
        }

        const date = new Date().toISOString();

        return request({
          json: true,
          timeout: remoteServiceTimeoutMs,
          url: api,
        },
        (err, r, json) => {
          if (!!err) {
            return cbk([503, 'UnexpectedErrorGettingCoingeckoRates', {err}]);
          }

          if (!json || !json.rates) {
            return cbk([503, 'ExpectedRatesInCoingeckoResponse']);
          }

          if (!!symbols.find(code => !json.rates[code.toLowerCase()])) {
            return cbk([404, 'CoingeckoRateLookupSymbolNotFound']);
          }

          const tickers = symbols.map(code => {
            const price = json.rates[code.toLowerCase()];

            return {
              date,
              ticker: code.toUpperCase(),
              rate: price.value * centsPerDollar,
            };
          });

          return cbk(null, tickers);
        });
      }],

      // Final set of prices
      prices: ['getPrices', ({getPrices}, cbk) => {
        return cbk(null, {tickers: getPrices});
      }],
    },
    returnResult({reject, resolve, of: 'prices'}, cbk));
  });
};
