const {test} = require('@alexbosworth/tap');

const getMaximum = require('./../../routing/get_maximum');

const space = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const makeTest = val => ({cursor}, cbk) => cbk(null, space[cursor] <= val);

const tests = [
  {
    args: {from: 0, test: makeTest(4), to: 10},
    description: 'Find maximum',
    expected: {maximum: 4},
  },
  {
    args: {from: 0, test: makeTest(0), to: 10},
    description: 'Find maximum when no value is accepted',
    expected: {maximum: undefined},
  },
  {
    args: {from: 0, test: makeTest(10), to: 10},
    description: 'Find maximum at the top',
    expected: {maximum: 10},
  },
  {
    args: {accuracy: 3, from: 0, test: makeTest(10), to: 10},
    description: 'Find maximum at the top',
    expected: {maximum: 9},
  },
  {
    args: {},
    description: 'Lower bound value required',
    error: [400, 'ExpectedLowerValueToGetMaximum'],
  },
  {
    args: {from: 5},
    description: 'Test function required',
    error: [400, 'ExpectedTestFunctionToGetMaximumValue'],
  },
  {
    args: {from: 5, test: makeTest(10)},
    description: 'Upper bound value required',
    error: [400, 'ExpectedUpperValueToGetMaximum'],
  },
  {
    args: {from: 5, test: makeTest(10), to: 4},
    description: 'Upper bound value required',
    error: [400, 'ExpectedLowValueLowerThanUpperValueToGetMaximum'],
  },
  {
    args: {from: 5, test: ({}, cbk) => cbk([503, 'Error']), to: 10},
    description: 'Upper bound value required',
    error: [503, 'Error'],
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects}) => {
    if (!!error) {
      rejects(getMaximum(args, args.test), error, 'Got expected error');
    } else {
      const {maximum} = await getMaximum(args, args.test);

      equal(maximum, expected.maximum, 'Got expected value');
    }

    return end();
  });
});
