const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {returnResult} = require('asyncjs-util');

const getCoindeskCurrentPrice = require('./get_coindesk_current_price');

const currency = 'BTC';
const defaultFiat = 'USD';
const {isArray} = Array;
const uniq = arr => Array.from(new Set(arr));

/** Get exchange rates from CoinDesk

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
          return cbk([400, 'ExpectedSymbolsToGetCoindeskExchangeRates']);
        }

        return cbk();
      },

      // Fetch all the prices
      getPrices: ['validate', ({}, cbk) => {
        if (!symbols.length) {
          symbols.push(defaultFiat);
        }

        return asyncMap(uniq(symbols), (fiat, cbk) => {
          return getCoindeskCurrentPrice({
            currency,
            fiat,
            request
          },
          (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            return cbk(null, {date: res.date, rate: res.cents, ticker: fiat});
          });
        },
        cbk);
      }],

      // Final set of prices
      prices: ['getPrices', ({getPrices}, cbk) => {
        return cbk(null, {tickers: getPrices});
      }],
    },
    returnResult({reject, resolve, of: 'prices'}, cbk));
  });
};
