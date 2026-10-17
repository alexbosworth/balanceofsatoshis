const {deepEqual} = require('node:assert').strict;
const test = require('node:test');

const method = require('./../../chain/funded_outputs');

const makeArgs = overrides => {
  const args = {
    counted: 0,
    inputs: 1,
    needed: 2,
    rate: 1,
    size: 10000,
    tokens: 100000,
    vbytes: 69,
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({}),
    description: 'Large enough change counts as one of the new utxos',
    expected: {outputs: 1},
  },
  {
    args: makeArgs({tokens: 20150}),
    description: 'Small change does not count so all outputs are made',
    expected: {outputs: 2},
  },
  {
    args: makeArgs({tokens: 20100}),
    description: 'Inputs that cannot pay for the outputs fund nothing',
    expected: {},
  },
  {
    args: makeArgs({counted: 1, needed: 1, tokens: 20150}),
    description: 'Spent counted utxos have to be replaced',
    expected: {outputs: 2},
  },
  {
    args: makeArgs({needed: 1, tokens: 10111}),
    description: 'A single output cannot be replaced by change',
    expected: {outputs: 1},
  },
];

tests.forEach(({args, description, expected}) => {
  return test(description, () => {
    deepEqual(method(args), expected, 'Got expected funded outputs');

    return;
  });
});
