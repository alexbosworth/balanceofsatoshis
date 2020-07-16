const {test} = require('@alexbosworth/tap');

const {ignoreFromAvoid} = require('./../../routing');

const tests = [
  {
    args: {avoid: 'a'},
    description: 'Avoid public key mapped to ignore',
    expected: {ignore: [{from_public_key: 'a'}]}
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({deepIs, end, throws}) => {
    deepIs(ignoreFromAvoid(args).ignore, expected.ignore, 'Got ignores');

    return end();
  });
});
