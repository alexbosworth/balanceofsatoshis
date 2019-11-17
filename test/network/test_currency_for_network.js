const {test} = require('tap');

const {currencyForNetwork} = require('./../../network');

const tests = [
  {
    args: {},
    description: 'A chains array is expected',
    error: 'ExpectedArrayOfChainsToDetermineCurrencyForNetwork',
  },
  {
    args: {chains: ['chain', 'chain']},
    description: 'A chains array with a single element is expected',
    error: 'CannotDetermineCurrencyForMultipleChains',
  },
  {
    args: {chains: ['chain']},
    description: 'A known chain is expected',
    error: 'UnknownChainForCurrency',
  },
  {
    args: {
      chains: [
        '6fe28c0ab6f1b372c1a6a246ae63f74f931e8365e15a089c68d6190000000000',
      ],
    },
    description: 'A known chain returns a currency',
    expected: {currency: 'BTC'},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, throws}) => {
    if (!!error) {
      throws(() => currencyForNetwork(args), new Error(error), 'Got error');
    } else {
      const {currency} = currencyForNetwork(args);

      equal(currency, expected.currency, 'Got expected currency');
    }

    return end();
  });
});
