const {test} = require('@alexbosworth/tap');

const {getCoindeskRates} = require('./../../fiat');

const updatedISO = '2020-01-13T20:13:00+00:00';

const body = {bpi: {EUR: {rate_float: 1}}, time: {updatedISO: updatedISO}};

const makeRequest = (err, res) => ({}, cbk) => cbk(err, null, res);

const makeArgs = override => {
  const args = {request: makeRequest(null, body), symbols: ['EUR']};

  Object.keys(override).forEach(key => args[key] = override[key]);

  return args;
};

const tests = [
  {
    args: makeArgs({symbols: undefined}),
    description: 'Symbols are required',
    error: [400, 'ExpectedSymbolsToGetCoindeskExchangeRates'],
  },
  {
    args: makeArgs({symbols: ['FOO']}),
    description: 'Known symbols are required',
    error: [400, 'UnsupportedFiatTypeForCoindeskFiatRateLookup'],
  },
  {
    args: makeArgs({request: undefined}),
    description: 'A request function is required',
    error: [400, 'ExpectedRequestFunctionToGetExchangeRates'],
  },
  {
    args: makeArgs({request: makeRequest('err')}),
    description: 'Request cannot return error',
    error: [503, 'UnexpectedErrorGettingCoindeskPrice', {err: 'err'}],
  },
  {
    args: makeArgs({
      symbols: [],
      request: makeRequest(null, {
        bpi: {USD: {rate_float: 1}},
        time: {updatedISO: updatedISO},
      }),
    }),
    description: 'Got default exchange rate',
    expected: {
      tickers: [{
        date: '2020-01-13T20:13:00.000Z',
        rate: 100,
        ticker: 'USD',
      }],
    },
  },
  {
    args: makeArgs({}),
    description: 'Got exchange rates',
    expected: {
      tickers: [{
        date: '2020-01-13T20:13:00.000Z',
        rate: 100,
        ticker: 'EUR',
      }],
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects}) => {
    if (!!error) {
      rejects(getCoindeskRates(args), error, 'Got expected error');

      return end();
    }

    const [expectedTicker] = expected.tickers;
    const [ticker] = (await getCoindeskRates(args)).tickers;

    equal(ticker.date, expectedTicker.date, 'Got expected ticker date');
    equal(ticker.rate, expectedTicker.rate, 'Got expected ticker rate');
    equal(ticker.ticker, expectedTicker.ticker, 'Got expected symbol');

    return end();
  });
});
