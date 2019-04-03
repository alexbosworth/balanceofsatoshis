const {test} = require('tap');

const balanceFromTokens = require('./../../balances/balance_from_tokens');

const tests = [
  // Normal balance
  {
    args: {tokens: [1, 2, 3, 4, 5]},
    description: 'Tokens are summed to a balance',
    expected: {balance: 15},
  },

  // Balance above watermark
  {
    args: {above: 10, tokens: [1, 2, 3, 4, 5]},
    description: 'Tokens are summed to a balance',
    expected: {balance: 5},
  },

  // Balance below watermark
  {
    args: {below: 25, tokens: [1, 2, 3, 4, 5]},
    description: 'Tokens are summed to a balance',
    expected: {balance: 10},
  },
];

tests.forEach(({args, description, expected}) => {
  return test(description, ({end, equal}) => {
    const balance = balanceFromTokens(args);

    equal(balance, expected.balance, 'Balance is calculated');

    return end();
  });
});
