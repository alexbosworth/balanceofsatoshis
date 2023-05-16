const {test} = require('@alexbosworth/tap');

const {returnJson} = require('./../../responses');

const tests = [
  {
    description: 'Error returns an error',
    error: 'error',
  },
  {
    args: [],
    description: 'Output returns output',
    expected: '[]',
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, ({end, equal, throws}) => {
    if (!!error) {
      let err;

      return returnJson({
        logger: {error: n => err = n},
        reject: () => {
          equal(err, error, 'Error as expected');

          return end();
        },
      })(error);
    }

    let output;

    return returnJson({
      logger: {info: n => output = n},
      resolve: () => {
        equal(output, expected, 'Got expected output');

        return end();
      },
    })(null, args);
  });
});
