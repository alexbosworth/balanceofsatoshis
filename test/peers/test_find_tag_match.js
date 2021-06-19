const {test} = require('@alexbosworth/tap');

const {findTagMatch} = require('./../../peers');

const makeArgs = overrides => {
  const args = {
    channels: [{partner_public_key: Buffer.alloc(33, 3).toString('hex')}],
    query: '0000',
    tags: [{
      id: Buffer.alloc(32).toString('hex'),
      nodes: [Buffer.alloc(33, 3).toString('hex')],
    }],
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({}),
    description: 'A tagged node is found',
    expected: {match: Buffer.alloc(33, 3).toString('hex')},
  },
  {
    args: makeArgs({
      tags: [{id: Buffer.alloc(32).toString('hex')}],
    }),
    description: 'No tagged node is found',
    expected: {},
  },
  {
    args: makeArgs({
      channels: [
        {partner_public_key: Buffer.alloc(33, 2).toString('hex')},
        {partner_public_key: Buffer.alloc(33, 3).toString('hex')},
      ],
      query: 'alias',
      tags: [
        {
          alias: 'alias1',
          id: Buffer.alloc(32).toString('hex'),
          nodes: [Buffer.alloc(33, 2).toString('hex')],
        },
        {
          alias: 'alias2',
          id: Buffer.alloc(32, 1).toString('hex'),
          nodes: [Buffer.alloc(33, 3).toString('hex')],
        },
      ],
    }),
    description: 'Multiple tags are found',
    expected: {
      matches: [
        {
          alias: 'alias1',
          id: Buffer.alloc(32).toString('hex'),
          nodes: [Buffer.alloc(33, 2).toString('hex')],
        },
        {
          alias: 'alias2',
          id: Buffer.alloc(32, 1).toString('hex'),
          nodes: [Buffer.alloc(33, 3).toString('hex')],
        },
      ],
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, ({end, equal, strictSame, throws}) => {
    if (!!error) {
      throws(() => findTagMatch(args), new Error(error), 'Got error');
    } else {
      const res = findTagMatch(args);

      strictSame(res, expected, 'Got expected rule violation');
    }

    return end();
  });
});
