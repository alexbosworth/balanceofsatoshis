const {test} = require('@alexbosworth/tap');

const {getPrices} = require('./../../fiat');

const updatedISO = '2020-01-13T20:13:00+00:00';

const body = {rates: {eur: {value: 1}, usd: {value: 2}}};

const makeRequest = (err, res) => ({}, cbk) => cbk(err, null, res);

const makeArgs = override => {
  const args = {
    from: 'coingecko',
    request: makeRequest(null, body),
    symbols: ['EUR'],
  };

  Object.keys(override).forEach(key => args[key] = override[key]);

  return args;
};

const tests = [
  {
    args: makeArgs({from: undefined}),
    description: 'Provider is required',
    error: [404, 'UnrecognizedRateProviderSpecifiedToGetPrice'],
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
      rejects(getPrices(args), error, 'Got expected error');

      return end();
    }

    const [expectedTicker] = expected.tickers;
    const [ticker] = (await getPrices(args)).tickers;

    equal(!!ticker.date, true, 'Got ticker date');
    equal(ticker.rate, expectedTicker.rate, 'Got expected ticker rate');
    equal(ticker.ticker, expectedTicker.ticker, 'Got expected symbol');

    getPrices(args, err => {
      equal(err, null, 'No error when calling with a cbk');

      return end();
    });
  });
});
