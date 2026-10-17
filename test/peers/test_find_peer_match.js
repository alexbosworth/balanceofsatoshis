const {deepEqual} = require('node:assert').strict;
const test = require('node:test');

const method = require('./../../peers/find_peer_match');

const key = Buffer.alloc(33, 3).toString('hex');
const otherKey = Buffer.alloc(33, 4).toString('hex');

const makeArgs = overrides => {
  const args = {
    channels: [
      {
        capacity: 3,
        id: '1x1x1',
        local_balance: 1,
        partner_public_key: key,
        pending_payments: [],
        remote_balance: 2,
      },
      {
        capacity: 3,
        id: '2x2x2',
        local_balance: 1,
        partner_public_key: otherKey,
        pending_payments: [],
        remote_balance: 2,
      },
    ],
    filters: ['inbound_fee_rate < 101'],
    nodes: [key],
    policies: [{base_fee_mtokens: '1000', fee_rate: 100, public_key: key}],
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({filters: undefined}),
    description: 'A peer is matched when there are no filters',
    expected: {match: key},
  },
  {
    args: makeArgs({}),
    description: 'A peer is matched on a fee filter',
    expected: {match: key},
  },
  {
    args: makeArgs({filters: ['inbound_fee_rate < 100']}),
    description: 'A peer is not matched when the fee filter is not satisfied',
    expected: {},
  },
  {
    args: makeArgs({policies: []}),
    description: 'A peer with no known fee policy does not match a fee filter',
    expected: {},
  },
  {
    args: makeArgs({policies: [{public_key: key}]}),
    description: 'A peer with no known fee rate does not match a fee filter',
    expected: {},
  },
  {
    args: makeArgs({filters: ['capacity > 2'], policies: []}),
    description: 'A peer with no known fee policy matches other filters',
    expected: {match: key},
  },
  {
    args: makeArgs({nodes: [key, otherKey], policies: []}),
    description: 'Peers with unknown fees are passed over for a fee filter',
    expected: {},
  },
  {
    args: makeArgs({
      nodes: [key, otherKey],
      policies: [{fee_rate: 50, base_fee_mtokens: '1', public_key: otherKey}],
    }),
    description: 'A peer with a known fee is matched over an unknown fee peer',
    expected: {match: otherKey},
  },
  {
    args: makeArgs({
      policies: [{fee_rate: 100, is_disabled: true, public_key: key}],
    }),
    description: 'A peer with a disabled policy is not matched',
    expected: {},
  },
  {
    args: makeArgs({filters: ['invalid formula']}),
    description: 'A failed formula is returned',
    expected: {
      failure: {
        error: 'UnexpectedTrailingTokenForFormulaParsing',
        formula: 'invalid formula',
      },
    },
  },
];

tests.forEach(({args, description, expected}) => {
  return test(description, () => {
    deepEqual(method(args), expected, 'Got expected result');

    return;
  });
});
