const {deepEqual} = require('node:assert').strict;
const test = require('node:test');
const {throws} = require('node:assert').strict;

const method = require('./../../display/is_matching_filters');

const tests = [
  {
    args: {filters: [], variables: {}},
    description: 'No filters matches all results',
    expected: {is_matching: true},
  },
  {
    args: {filters: ['foo'], variables: {}},
    description: 'An invalid filter returns a failure',
    expected: {
      failure: {
        error: 'UnrecognizedVariableOrFunctionInFormula',
        formula: 'foo',
      },
    },
  },
  {
    args: {filters: ['foo > 1'], variables: {foo: 2}},
    description: 'A filter match is returned',
    expected: {is_matching: true},
  },
  {
    args: {filters: ['foo > 3'], variables: {foo: 2}},
    description: 'A filter fail is returned',
    expected: {is_matching: false},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, (t, end) => {
    if (!!error) {
      throws(() => method(args), new Error(error), 'Got error');
    } else {
      const res = method(args);

      deepEqual(res, expected, 'Got expected result');
    }

    return end();
  });
});
