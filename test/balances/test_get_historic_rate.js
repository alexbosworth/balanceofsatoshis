const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const method = require('./../../balances/get_historic_rate');

const dayStart = Date.parse('2017-12-17T00:00:00.000Z') / 1000;

// Coinbase Exchange has a candle for the 10:00 hour of the day
const candles = [[dayStart + 60 * 60 * 10, 18900, 19200, 19000, 19200, 5]];

const makeArgs = overrides => {
  const args = {
    currency: 'BTC',
    date: '2017-12-17T10:30:00.000Z',
    fiat: 'USD',
    from: 'coinbase',
    request: ({}, cbk) => cbk(null, {statusCode: 200}, candles),
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({currency: 'ETH'}),
    description: 'BTC is the only currency',
    error: [400, 'UnsupportedCurrencyToGetHistoricRate'],
  },
  {
    args: makeArgs({date: undefined}),
    description: 'A date is required',
    error: [400, 'ExpectedDateToGetHistoricRate'],
  },
  {
    args: makeArgs({fiat: undefined}),
    description: 'A fiat is required',
    error: [400, 'ExpectedFiatToGetHistoricRate'],
  },
  {
    args: makeArgs({from: undefined}),
    description: 'A rate provider is required',
    error: [400, 'ExpectedRateProviderToGetHistoricRate'],
  },
  {
    args: makeArgs({request: undefined}),
    description: 'A request function is required',
    error: [400, 'ExpectedRequestFunctionToGetHistoricRate'],
  },
  {
    args: makeArgs({}),
    description: 'The rate at the hour of the date is returned',
    expected: {cents: 1910000},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(method(args), error, 'Got expected error');
    } else {
      deepEqual(await method(args), expected, 'Got expected rate');
    }

    return;
  });
});
