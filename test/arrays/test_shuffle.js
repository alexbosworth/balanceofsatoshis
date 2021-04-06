const {test} = require('tap');

const {shuffle} = require('./../../arrays');

const tests = [
  {
    args: {},
    description: 'An array is required',
    error: 'ExpectedArrayToShuffle',
  },
  {
    args: {array: []},
    description: 'An empty array returns an empty array',
    expected: {shuffled: ''},
  },
  {
    args: {array: [1, 2, 3]},
    description: 'An array is shuffled as expected',
    expected: {shuffled: '3,1,2'},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, ({end, equal, strictSame, throws}) => {
    if (!!error) {
      throws(() => shuffle(args), new Error(error), 'Got expected error');
    } else if (!expected.shuffled) {
      equal(shuffle(args).shuffled.join(''), '', 'Empty array is returned');
    } else {
      let shuffled = [];

      while (shuffled.join(',') !== expected.shuffled) {
        shuffled = shuffle(args).shuffled;
      }

      equal(shuffled.join(','), expected.shuffled, 'Array is shuffled');
    }

    return end();
  });
});
