const request = require('request');

const cents = 100;
const defaultFiat = 'USD';
const {floor} = Math;
const from = 'BTC';
const {isArray} = Array;
const known = ['GBP', 'EUR', 'USD'];
const msPerSec = 1e3;
const separator = ',';
const url = 'https://apiv2.bitcoinaverage.com/indices/global/ticker/short';

/** Get exchange rates

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
  if (!isArray(symbols)) {
    return cbk([400, 'ExpectedArrayOfDestinationSymbolsForExchangeRates']);
  }

  const unknownSymbol = symbols.find(symbol => !known.find(n => n === symbol));

  if (!!unknownSymbol) {
    return cbk([400, 'UnexpectedUnknownFiatSymbol', unknownSymbol]);
  }

  const toFiat = !symbols.length ? [defaultFiat] : symbols;

  return request({
    url,
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
};
