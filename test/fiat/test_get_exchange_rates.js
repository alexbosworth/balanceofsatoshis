const {test} = require('@alexbosworth/tap');

const {getExchangeRates} = require('./../../fiat');

const read = ({}, cbk) => cbk();

const tests = [
  {
    args: {},
    description: 'Symbols are required',
    error: [400, 'ExpectedArrayOfFiatSymbolsForExchangeRates'],
  },
  {
    args: {symbols: ['USD', 'FOO']},
    description: 'Known symbols are required',
    error: [400, 'UnexpectedUnknownFiatSymbol', {unknown: 'FOO'}],
  },
  {
    args: {request: ({}, cbk) => cbk('err'), symbols: []},
    description: 'Request cannot return error',
    error: [503, 'UnexpectedErrorGettingExchangeRates', {err: 'err'}],
  },
  {
    args: {request: ({}, cbk) => cbk(null), symbols: []},
    description: 'Request must return response',
    error: [503, 'UnexpectedResponseFromExchangeRateProvider'],
  },
  {
    args: {
      read,
      request: ({}, cbk) => cbk(null, {statusCode: 1}),
      symbols: [],
    },
    description: 'Request must return correct status code',
    error: [503, 'UnexpectedStatusCodeFromExchangeRateProvider'],
  },
  {
    args: {
      read,
      request: ({}, cbk) => cbk(null, {statusCode: 200}),
      symbols: [],
    },
    description: 'Request must return not empty response',
    error: [503, 'ExpectedNonEmptyResponseFromRateProvider'],
  },
  {
    args: {
      read,
      request: ({}, cbk) => cbk(null, {statusCode: 200}, {}),
      symbols: [],
    },
    description: 'Request must return response',
    error: [503, 'MissingTickerDataForResponse'],
  },
  {
    args: {
      read,
      request: ({}, cbk) => cbk(null, {statusCode: 200}, {BTCUSD: {}}),
      symbols: [],
    },
    description: 'Request must return response',
    error: [503, 'MissingTickerDataForResponse'],
  },
  {
    args: {
      read,
      request: ({}, cbk) => cbk(null, {statusCode: 200}, {BTCUSD: {last: 1}}),
      symbols: [],
    },
    description: 'Request must return response',
    error: [503, 'MissingTickerDataForResponse'],
  },
  {
    args: {
      read,
      request: ({}, cbk) => cbk(null, {statusCode: 200}, {BTCUSD: {last: 1, timestamp: 1}}),
      symbols: [],
    },
    description: 'Got exchange rates',
    expected: {
      tickers: [{
        date: '1970-01-01T00:00:01.000Z',
        rate: 100,
        ticker: 'USD',
      }],
    },
  },
  {
    args: {
      read,
      request: ({}, cbk) => cbk(null, {statusCode: 200}, {BTCUSD: {last: 1, timestamp: 1}}),
      symbols: ['USD'],
    },
    description: 'Got exchange rates',
    expected: {
      tickers: [{
        date: '1970-01-01T00:00:01.000Z',
        rate: 100,
        ticker: 'USD',
      }],
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects}) => {
    if (!!error) {
      rejects(getExchangeRates(args), error, 'Got expected error');

      return end();
    }

    const [expectedTicker] = expected.tickers;
    const [ticker] = (await getExchangeRates(args)).tickers;

    equal(ticker.date, expectedTicker.date, 'Got expected ticker date');
    equal(ticker.rate, expectedTicker.rate, 'Got expected ticker rate');
    equal(ticker.ticker, expectedTicker.ticker, 'Got expected symbol');

    return end();
  });
});
