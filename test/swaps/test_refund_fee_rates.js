const {deepEqual} = require('node:assert').strict;
const {throws} = require('node:assert').strict;
const test = require('node:test');

const refundFeeRates = require('./../../swaps/refund_fee_rates');

// Summarize fee rates as the fee rates and when each one unlocks
const summary = ({rates}) => ({
  delays: rates.map(n => n.delay),
  fee_rates: rates.map(n => n.fee_rate),
});

const makeArgs = overrides => {
  const args = {delay_blocks: 144, fee_rate: 3, max_multiple: 64, near: 2};

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const makeExpected = overrides => {
  const expected = {
    delays: [0, 0, 0, 0, 0, 144, 288, 432, 576, 720, 864],
    fee_rates: [1, 2, 3, 4, 5, 10, 20, 40, 80, 160, 192],
  };

  Object.keys(overrides).forEach(k => expected[k] = overrides[k]);

  return expected;
};

const tests = [
  {
    args: makeArgs({delay_blocks: -1}),
    description: 'Delay blocks for each doubling are expected',
    error: 'ExpectedDelayBlocksToGetRefundFeeRates',
  },
  {
    args: makeArgs({fee_rate: undefined}),
    description: 'A current fee rate is expected',
    error: 'ExpectedCurrentFeeRateToGetRefundFeeRates',
  },
  {
    args: makeArgs({fee_rate: -1}),
    description: 'A current fee rate is expected to be above zero',
    error: 'ExpectedCurrentFeeRateToGetRefundFeeRates',
  },
  {
    args: makeArgs({max_multiple: 0}),
    description: 'A maximum fee rate multiple is expected',
    error: 'ExpectedMaxFeeRateMultipleToGetRefundFeeRates',
  },
  {
    args: makeArgs({near: -1}),
    description: 'A count of fee rates near the fee rate is expected',
    error: 'ExpectedNearFeeRatesCountToGetRefundFeeRates',
  },
  {
    args: makeArgs({}),
    description: 'Rates near the fee rate unlock first, then each doubling',
    expected: makeExpected({}),
  },
  {
    args: makeArgs({fee_rate: 2.4}),
    description: 'A fractional fee rate is rounded up',
    expected: makeExpected({}),
  },
  {
    args: makeArgs({fee_rate: 1}),
    description: 'No fee rates under one are used',
    expected: makeExpected({
      delays: [0, 0, 0, 144, 288, 432, 576, 720],
      fee_rates: [1, 2, 3, 6, 12, 24, 48, 64],
    }),
  },
  {
    args: makeArgs({fee_rate: 10}),
    description: 'Rates are near a higher fee rate',
    expected: makeExpected({
      fee_rates: [8, 9, 10, 11, 12, 24, 48, 96, 192, 384, 640],
    }),
  },
  {
    args: makeArgs({max_multiple: 8, near: 0}),
    description: 'Fewer rates are the fee rate and its doublings',
    expected: makeExpected({
      delays: [0, 144, 288, 432],
      fee_rates: [3, 6, 12, 24],
    }),
  },
  {
    args: makeArgs({delay_blocks: 0}),
    description: 'Every rate can unlock at once',
    expected: makeExpected({delays: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]}),
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, () => {
    if (!!error) {
      throws(() => refundFeeRates(args), new Error(error), 'Got error');
    } else {
      deepEqual(summary(refundFeeRates(args)), expected, 'Got fee rates');
    }

    return;
  });
});
