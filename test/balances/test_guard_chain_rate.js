const {deepEqual} = require('node:assert').strict;
const test = require('node:test');

const method = require('./../../balances/guard_chain_rate');

// Errors that mean the prices file has to be fixed before it can be used
const fileErrors = [
  'ExpectedPricesObjectInPricesFile',
  'FailedToParsePricesFile',
  'FailedToReadPricesFile',
  'FailedToReplacePricesFile',
  'FailedToWritePricesFile',
  'UnsupportedPricesFileVersion',
];

const tests = [
  {
    args: {res: {cents: 4266048}},
    description: 'A chain price is passed back',
    expected: {calls: 2, lookup: {res: {cents: 4266048}}},
  },
  {
    args: {err: [400, 'DateBeforeSupportedRangeToGetChainRate']},
    description: 'A date chain prices cannot value has no price',
    expected: {calls: 2, lookup: {res: undefined}},
  },
  {
    args: {err: [503, 'UnexpectedErrorGettingBlock']},
    description: 'A chain price that cannot be derived is not a price',
    expected: {calls: 2, lookup: {res: undefined}},
  },
  ...fileErrors.map(code => ({
    args: {err: [503, code]},
    description: `A prices file error stops later lookups: ${code}`,
    expected: {calls: 1, lookup: {err: [503, code]}},
  })),
];

tests.forEach(({args, description, expected}) => {
  return test(description, async () => {
    const calls = [];

    const {getChainRate} = method({
      getChainRate: ({}, cbk) => {
        calls.push(true);

        return cbk(args.err, args.res);
      },
    });

    const lookup = () => new Promise(resolve => {
      const date = '2024-01-01T12:00:00.000Z';

      return getChainRate({date, currency: 'BTC', fiat: 'USD'}, (err, res) => {
        return resolve(!!err ? {err} : {res});
      });
    });

    // The same date is looked up twice
    const lookups = [await lookup(), await lookup()];

    deepEqual(lookups, [expected.lookup, expected.lookup], 'Got lookups');
    deepEqual(calls.length, expected.calls, 'Got expected chain lookups');

    return;
  });
});
