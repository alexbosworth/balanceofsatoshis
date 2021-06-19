const {test} = require('@alexbosworth/tap');

const {sortBy} = require('./../../arrays');

const tests = [
  {
    args: {},
    description: 'An array is required',
    error: 'ExpectedArrayToSortByAttribute',
  },
  {
    args: {array: []},
    description: 'An attribute to sort by is required',
    error: 'ExpectedAttributeToSortArrayBy',
  },
  {
    args: {array: [{foo: 1}, {foo: 2}, {foo: 3}], attribute: 'foo'},
    description: 'Array is sorted when reversed',
    expected: {sorted: [{foo: 1}, {foo: 2}, {foo: 3}]},
  },
  {
    args: {array: [{foo: 1}, {foo: 3}, {foo: 2}], attribute: 'foo'},
    description: 'Array is sorted when jumbled',
    expected: {sorted: [{foo: 1}, {foo: 2}, {foo: 3}]},
  },
  {
    args: {array: [{foo: 3}, {foo: 3}, {foo: 2}], attribute: 'foo'},
    description: 'Array is sorted when equals exist',
    expected: {sorted: [{foo: 2}, {foo: 3}, {foo: 3}]},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, ({end, strictSame, throws}) => {
    if (!!error) {
      throws(() => sortBy(args), new Error(error), 'Got expected error');
    } else {
      const {sorted} = sortBy(args);

      strictSame(sorted, expected.sorted, 'Array is sorted as expected');
    }

    return end();
  });
});
