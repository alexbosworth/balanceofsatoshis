const {test} = require('@alexbosworth/tap');

const {returnOutput} = require('./../../responses');

const tests = [
  {
    description: 'Error returns an error',
    error: 'error',
  },
  {
    args: 'foo',
    description: 'Output returns output',
    expected: 'foo',
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, ({end, equal, throws}) => {
    if (!!error) {
      let err;

      return returnOutput({
        logger: {error: n => err = n},
        reject: () => {
          equal(err, error, 'Error as expected');

          return end();
        },
      })(error);
    }

    let output;

    return returnOutput({
      logger: {info: n => output = n},
      resolve: () => {
        equal(output, expected, 'Got expected output');

        return end();
      },
    })(null, args);
  });
});
