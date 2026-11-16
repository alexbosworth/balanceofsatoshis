const {deepEqual} = require('node:assert').strict;
const {throws} = require('node:assert').strict;
const test = require('node:test');

const selectByFeeRate = require('./../../swaps/select_by_fee_rate');

// Fee rates of a claims schedule that rises as the deadline nears
const rates = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 16, 20, 24, 32, 40, 64, 100];

const makeItems = feeRates => feeRates.map((rate, i) => ({
  fee_rate: rate,
  height: 100 + i,
}));

const makeArgs = overrides => {
  const args = {fee_rate: 5, items: makeItems(rates)};

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

// The fee rates of the selected items
const summary = ({items}) => ({fee_rates: items.map(n => n.fee_rate)});

const makeExpected = overrides => {
  const expected = {fee_rates: [3, 4, 5, 6, 7, 16, 32, 64, 100]};

  Object.keys(overrides).forEach(k => expected[k] = overrides[k]);

  return expected;
};

const tests = [
  {
    args: makeArgs({items: undefined}),
    description: 'Items are expected',
    error: 'ExpectedArrayOfItemsToSelectByFeeRate',
  },
  {
    args: makeArgs({items: []}),
    description: 'No items select nothing',
    expected: makeExpected({fee_rates: []}),
  },
  {
    args: makeArgs({}),
    description: 'Items near the fee rate are selected, then each doubling',
    expected: makeExpected({}),
  },
  {
    args: makeArgs({fee_rate: undefined}),
    description: 'Without a fee rate items are selected from the lowest',
    expected: makeExpected({fee_rates: [1, 2, 3, 6, 12, 24, 64, 100]}),
  },
  {
    args: makeArgs({fee_rate: 0.5}),
    description: 'A fee rate under every item selects from the lowest',
    expected: makeExpected({fee_rates: [1, 2, 3, 6, 12, 24, 64, 100]}),
  },
  {
    args: makeArgs({fee_rate: 500}),
    description: 'A fee rate over every item selects the highest items',
    expected: makeExpected({fee_rates: [40, 64, 100]}),
  },
  {
    args: makeArgs({near: 0}),
    description: 'Without items near the fee rate it is followed by doublings',
    expected: makeExpected({fee_rates: [5, 10, 20, 40, 100]}),
  },
  {
    args: makeArgs({fee_rate: 1, items: makeItems([1, 2, 4, 8])}),
    description: 'The last item is not selected twice',
    expected: makeExpected({fee_rates: [1, 2, 4, 8]}),
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, () => {
    if (!!error) {
      throws(() => selectByFeeRate(args), new Error(error), 'Got error');
    } else {
      deepEqual(summary(selectByFeeRate(args)), expected, 'Got fee rates');
    }

    return;
  });
});
