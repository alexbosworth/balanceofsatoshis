const {equal} = require('node:assert').strict;
const test = require('node:test');
const {throws} = require('node:assert').strict;

const openRequestViolation = require('./../../peers/open_request_violation');

const makeArgs = overrides => {
  const args = {
    capacities: [1, 2, 3],
    capacity: 4,
    channel_ages: [10],
    fee_rates: [5, 6],
    is_clearnet: true,
    is_private: true,
    is_tor: true,
    joint_public_capacity: 1,
    local_balance: 7,
    public_key: Buffer.alloc(33, 3).toString('hex'),
    rules: ['capacity > 5'],
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({capacities: undefined}),
    description: 'Capacities are required',
    error: 'ExpectedArrayOfCapacitiesToCheckForOpenRequestViolation',
  },
  {
    args: makeArgs({}),
    description: 'A rule is violated',
    expected: {rule: 'capacity > 5'},
  },
  {
    args: makeArgs({
      rules: [
        'local_balance > 1',
        'SUM(capacities) > 5',
        'MAX(fee_rates) < 7',
        `NOT(EXACT(public_key, '020202020202020202020202020202020202020202020202020202020202020202'))`,
        'MAX(channel_ages) > 9',
      ],
    }),
    description: 'Multiple rules are passed',
    expected: {rule: undefined},
  },
  {
    args: makeArgs({capacity: 6}),
    description: 'No rules are violated',
    expected: {rule: undefined},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, (t, end) => {
    if (!!error) {
      throws(() => openRequestViolation(args), new Error(error), 'Got error');
    } else {
      const {rule} = openRequestViolation(args);

      equal(rule, expected.rule, 'Got expected rule violation');
    }

    return end();
  });
});
