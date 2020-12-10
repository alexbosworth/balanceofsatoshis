const {test} = require('tap');

const {parseAmount} = require('./../../display');

const tests = [
  {
    args: {amount: 'amount'},
    description: 'A value is required',
    error: 'UnrecognizedVariableOrFunctionInSpecifiedAmount',
  },
  {
    args: {amount: '1/0'},
    description: 'Dividing by zero is not allowed',
    error: 'CannotDivideByZeroInSpecifiedAmount',
  },
  {
    args: {amount: '0.0.0'},
    description: 'A generic invalid amount is rejected',
    error: 'FailedToParseSpecifiedAmount',
  },
  {
    args: {amount: 'OCT2DEC()'},
    description: 'Invalid numbers are rejected',
    error: 'InvalidNumberFoundInSpecifiedAmount',
  },
  {
    args: {amount: '"string" + 1'},
    description: 'Invalid formulas are rejected',
    error: 'UnexpectedValueTypeInSpecifiedAmount',
  },
  {
    args: {amount: '1.20969468*btc', variables: {variable: 'value'}},
    description: 'A long precision BTC value is parsed',
    expected: {tokens: 120969468},
  },
  {
    args: {amount: '1.20969465*btc'},
    description: 'A long precision BTC value that rounds down is parsed',
    expected: {tokens: 120969465},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, ({end, equal, throws}) => {
    if (!!error) {
      throws(() => parseAmount(args), new Error(error), 'Got expected error');
    } else {
      const {tokens} = parseAmount(args);

      equal(tokens, expected.tokens, 'Got expected output');
    }

    return end();
  });
});
