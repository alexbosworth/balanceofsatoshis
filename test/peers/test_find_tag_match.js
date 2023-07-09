const {deepEqual} = require('node:assert').strict;
const test = require('node:test');
const {throws} = require('node:assert').strict;

const {findTagMatch} = require('./../../peers');

const makeArgs = overrides => {
  const args = {
    channels: [{
      id: '1x1x1',
      local_balance: 1,
      partner_public_key: Buffer.alloc(33, 3).toString('hex'),
      pending_payments: [],
      remote_balance: 2,
    }],
    policies: [],
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
    args: makeArgs({filters: ['invalid formula']}),
    description: 'A failed formula is provided',
    expected: {
      failure: {error: 'FailedToParseFormula', formula: 'invalid formula'},
    },
  },
  {
    args: makeArgs({
      channels: [
        {
          id: '1x1x1',
          local_balance: 1e3,
          partner_public_key: Buffer.alloc(33, 3).toString('hex'),
          pending_payments: [],
          remote_balance: 1,
        },
        {
          id: '2x2x2',
          local_balance: 1e8,
          partner_public_key: Buffer.alloc(33, 2).toString('hex'),
          pending_payments: [],
          remote_balance: 1,
        },
      ],
      filters: ['outbound_liquidity > 5*m'],
      tags: [{
        id: Buffer.alloc(32).toString('hex'),
        nodes: [
          Buffer.alloc(33, 2).toString('hex'),
          Buffer.alloc(33, 3).toString('hex'),
        ],
      }],
    }),
    description: 'A tagged node is found which complies with a filter',
    expected: {
      match: Buffer.alloc(33, 2).toString('hex'),
    },
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
        {
          id: '1x1x1',
          local_balance: 1,
          partner_public_key: Buffer.alloc(33, 2).toString('hex'),
          pending_payments: [],
          remote_balance: 1,
        },
        {
          id: '1x1x1',
          local_balaance: 1,
          partner_public_key: Buffer.alloc(33, 3).toString('hex'),
          pending_payments: [],
          remote_balance: 1,
        },
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
    description: 'An exact alias is required',
    expected: {},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, (t, end) => {
    if (!!error) {
      throws(() => findTagMatch(args), new Error(error), 'Got error');
    } else {
      const res = findTagMatch(args);

      deepEqual(res, expected, 'Got expected rule violation');
    }

    return end();
  });
});
