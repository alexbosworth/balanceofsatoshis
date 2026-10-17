const {deepEqual} = require('node:assert').strict;
const test = require('node:test');

const method = require('./../../chain/funding_keys');

const key1 = `02${'11'.repeat(32)}`;
const key2 = `03${'22'.repeat(32)}`;
const signature = Buffer.alloc(71, 3).toString('hex');

const tests = [
  {
    args: {},
    description: 'Funding keys are not found without a witness',
    expected: {},
  },
  {
    args: {witness: []},
    description: 'Funding keys are not found in an empty witness',
    expected: {},
  },
  {
    args: {witness: ['4c']},
    description: 'Funding keys are not found in a malformed script',
    expected: {},
  },
  {
    args: {witness: [Buffer.alloc(64, 5).toString('hex')]},
    description: 'Funding keys are not found in a key spend',
    expected: {},
  },
  {
    args: {witness: ['', signature, signature, `5121${key1}21${key2}52ae`]},
    description: 'Funding keys are only found in a 2 of 2 multisig',
    expected: {},
  },
  {
    args: {witness: ['', signature, signature, `5221${key1}21${key2}52ac`]},
    description: 'Funding keys are only found in a multisig script',
    expected: {},
  },
  {
    args: {witness: ['', signature, signature, '5201aa01bb52ae']},
    description: 'Funding keys must be public keys',
    expected: {},
  },
  {
    args: {witness: ['', signature, signature, `5221${key1}21${key2}52ae`]},
    description: 'Funding keys are found in the funding output spend witness',
    expected: {keys: [key1, key2]},
  },
];

tests.forEach(({args, description, expected}) => {
  return test(description, () => {
    deepEqual(method(args), expected, 'Got expected funding keys');

    return;
  });
});
