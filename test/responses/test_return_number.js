const {test} = require('tap');

const {returnNumber} = require('./../../responses');

const tests = [
  {
    description: 'Error returns an error',
    error: 'error',
  },
  {
    args: {number: 1},
    description: 'Number returns a number',
    expected: {number: '1'},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, ({end, equal, throws}) => {
    if (!!error) {
      return returnNumber({reject: err => {
        equal(err, error, 'Error as expected');

        return end();
      }})(error);
    }

    let number;

    return returnNumber({
      logger: {info: n => number = n},
      number: 'number',
      resolve: () => {
        equal(number, expected.number, 'Got expected number');

        return end();
      },
    })(null, args);
  });
});
