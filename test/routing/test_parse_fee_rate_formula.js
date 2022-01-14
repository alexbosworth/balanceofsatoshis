const {test} = require('@alexbosworth/tap');

const method = require('./../../routing/parse_fee_rate_formula');

const makeArgs = overrides => {
  const args = {
    fee_rate: '1',
    inbound_fee_rate: 1,
    inbound_liquidity: 1,
    outbound_liquidity: 1,
    node_rates: [{key: 'key', rate: 1}],
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({fee_rate: undefined}),
    description: 'Fee rate is optional',
    expected: {},
  },
  {
    args: makeArgs({}),
    description: 'Fee rate formula is parsed',
    expected: {rate: 1},
  },
  {
    args: makeArgs({fee_rate: 'BIPS(25)'}),
    description: 'BIPs function is parsed',
    expected: {rate: 2500},
  },
  {
    args: makeArgs({fee_rate: 'PERCENT(0.25)'}),
    description: 'PERCENT function is parsed',
    expected: {rate: 2500},
  },
  {
    args: makeArgs({fee_rate: '1/0'}),
    description: 'Cannot divide by zero',
    expected: {failure: 'FeeRateCalculationCannotDivideByZeroFormula'},
  },
  {
    args: makeArgs({fee_rate: '/'}),
    description: 'Formula must be valid',
    expected: {failure: 'FailedToParseFeeRateFormula'},
  },
  {
    args: makeArgs({fee_rate: 'fee_rate'}),
    description: 'Formula must be valid',
    expected: {failure: 'UnrecognizedVariableOrFunctionInFeeRateFormula'},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, strictSame, throws}) => {
    if (!!error) {
      throws(() => method(args), new Error(error), 'Got expected error');
    } else {
      strictSame(method(args), expected, 'Got expected result');
    }

    return end();
  });
});
