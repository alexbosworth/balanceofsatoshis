const {deepEqual} = require('node:assert').strict;
const test = require('node:test');

const method = require('./../../chain/split_fee');

const makeArgs = overrides => {
  const args = {inputs: 1, outputs: 2, rate: 1, vbytes: 69};

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({}),
    description: 'The fee covers the inputs and split outputs',
    expected: 142,
  },
  {
    args: makeArgs({has_change: true, rate: 2}),
    description: 'A change output adds to the fee',
    expected: 370,
  },
  {
    args: makeArgs({inputs: 253, vbytes: 253 * 69}),
    description: 'A large count of inputs needs a wider count',
    expected: 17532,
  },
  {
    args: makeArgs({rate: 1.1}),
    description: 'The fee is rounded up',
    expected: 157,
  },
];

tests.forEach(({args, description, expected}) => {
  return test(description, () => {
    deepEqual(method(args), expected, 'Got expected split fee');

    return;
  });
});
