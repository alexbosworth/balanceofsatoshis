const {test} = require('tap');

const {ignoreFromAvoid} = require('./../../routing');

const tests = [
  {
    args: {avoid: 'a'},
    description: 'Avoid public key mapped to ignore',
    expected: {ignore: [{from_public_key: 'a'}]}
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, strictSame, throws}) => {
    strictSame(ignoreFromAvoid(args).ignore, expected.ignore, 'Got ignores');

    return end();
  });
});
