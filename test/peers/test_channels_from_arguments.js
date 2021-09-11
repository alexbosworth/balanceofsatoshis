const {test} = require('@alexbosworth/tap');

const method = require('./../../peers/channels_from_arguments');

const makeArgs = overrides => {
  const args = {
    capacities: [2],
    gives: ['1'],
    nodes: [Buffer.alloc(33, 3).toString('hex')],
    types: ['private'],
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({}),
    description: 'Arguments are mapped to channel details',
    expected: {
      channels: [{
        capacity: 2,
        give_tokens: 1,
        is_private: true,
        partner_public_key: Buffer.alloc(33, 3).toString('hex'),
      }],
    },
  },
  {
    args: makeArgs({
      capacities: [],
      gives: [],
      types: [],
    }),
    description: 'Remove optional arguments',
    expected: {
      channels: [{
        capacity: 5000000,
        give_tokens: undefined,
        is_private: false,
        partner_public_key: Buffer.alloc(33, 3).toString('hex'),
      }],
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, ({end, equal, strictSame, throws}) => {
    if (!!error) {
      throws(() => method(args), new Error(error), 'Got error');
    } else {
      const res = method(args);

      strictSame(res, expected, 'Got expected result');
    }

    return end();
  });
});
