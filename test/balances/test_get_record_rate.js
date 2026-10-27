const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const method = require('./../../balances/get_record_rate');

// Coinbase Exchange has an hourly candle at the start of the day
const candles = [[0, 12.34, 12.34, 12.34, 12.34, 1]];

const makeArgs = overrides => {
  const args = {
    currency: 'BTC',
    date: '1970-01-01T00:00:01.000Z',
    fiat: 'USD',
    request: ({}, cbk) => cbk(null, {statusCode: 200}, candles),
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({request: undefined}),
    description: 'A request function is required',
    error: [400, 'ExpectedRequestFunctionToGetRecordRate'],
  },
  {
    args: makeArgs({get_chain_rate: ({}, cbk) => cbk(null, {cents: 4266048})}),
    description: 'A record with a chain price is valued with it',
    expected: {cents: 4266048},
  },
  {
    args: makeArgs({get_chain_rate: ({}, cbk) => cbk()}),
    description: 'A record chain prices cannot value is valued on Coinbase',
    expected: {cents: 1234},
  },
  {
    args: makeArgs({
      get_chain_rate: ({}, cbk) => cbk([503, 'FailedToWritePricesFile']),
    }),
    description: 'Errors getting chain prices are passed back',
    error: [503, 'FailedToWritePricesFile'],
  },
  {
    args: makeArgs({}),
    description: 'Without chain prices a record is valued on Coinbase',
    expected: {cents: 1234},
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
