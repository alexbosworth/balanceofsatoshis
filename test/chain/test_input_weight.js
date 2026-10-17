const {deepEqual} = require('node:assert').strict;
const test = require('node:test');

const method = require('./../../chain/input_weight');

const tests = [
  {
    args: {script: ''},
    description: 'An input without witness data is all base weight',
    expected: 164,
  },
  {
    args: {script: '00'.repeat(23)},
    description: 'ScriptSig bytes count as base weight',
    expected: 256,
  },
  {
    args: {script: '', witness: ['00'.repeat(72), '00'.repeat(33)]},
    description: 'Witness elements are added to the base weight',
    expected: 272,
  },
];

tests.forEach(({args, description, expected}) => {
  return test(description, () => {
    deepEqual(method(args), expected, 'Got expected input weight');

    return;
  });
});
