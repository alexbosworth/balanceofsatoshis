const {test} = require('tap');

const {ignoreFromAvoid} = require('./../../routing');

const tests = [
  {
    args: {avoid: 'a'},
    description: 'Only accept public keys for avoid list',
    error: 'ExpectedHexEncodedPublicKeyToAvoid',
  },
  {
    args: {avoid: Buffer.alloc(33).toString('hex')},
    description: 'Avoid public key mapped to ignore',
    expected: {ignore: [{from_public_key: Buffer.alloc(33).toString('hex')}]},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, strictSame, throws}) => {
    if (!!error) {
      throws(() => ignoreFromAvoid(args), new Error(error), 'Got error');
    } else {
      strictSame(ignoreFromAvoid(args).ignore, expected.ignore, 'Got ignores');
    }

    return end();
  });
});
