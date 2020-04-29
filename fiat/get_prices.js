const getCoindeskRates = require('./get_coindesk_rates');
const getCoingeckoRates = require('./get_coingecko_rates');

/** Get exchange rates

  {
    from: <Rate Provider String>
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
module.exports = ({from, request, symbols}, cbk) => {
  switch (from) {
  case 'coindesk':
    return getCoindeskRates({request, symbols}, cbk);

  case 'coingecko':
    return getCoingeckoRates({request, symbols}, cbk);

  default:
    if (!!cbk) {
      return cbk([404, 'UnrecognizedRateProviderSpecifiedToGetPrice']);
    }

    return new Promise((resolve, reject) => {
      return reject([404, 'UnrecognizedRateProviderSpecifiedToGetPrice']);
    });
  }
};