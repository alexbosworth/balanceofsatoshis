const {deepEqual} = require('node:assert').strict;
const test = require('node:test');

const {returnChart} = require('./../../responses');

const tests = [
  {
    description: 'Error returns an error',
    error: 'error',
  },
  {
    args: {data: 'elements'},
    description: 'Data returns a chart',
    expected: [
      '',
      '       3.00 ┤ ╭ \n       2.87 ┤ │ \n       2.73 ┤ │ \n       2.60 ┤ │ \n       2.47 ┤ │ \n       2.33 ┤ │ \n       2.20 ┤ │ \n       2.07 ┤ │ \n       1.93 ┤╭╯ \n       1.80 ┤│  \n       1.67 ┤│  \n       1.53 ┤│  \n       1.40 ┤│  \n       1.27 ┤│  \n       1.13 ┤│  \n       1.00 ┼╯  ',
      '',
    ],
    res: {elements: [1,2,3]},
  },
  {
    args: {data: 'elements'},
    description: 'Data returns a chart and description',
    expected: [
      '\n       title\n',
      '       3.00 ┤ ╭ \n       2.87 ┤ │ \n       2.73 ┤ │ \n       2.60 ┤ │ \n       2.47 ┤ │ \n       2.33 ┤ │ \n       2.20 ┤ │ \n       2.07 ┤ │ \n       1.93 ┤╭╯ \n       1.80 ┤│  \n       1.67 ┤│  \n       1.53 ┤│  \n       1.40 ┤│  \n       1.27 ┤│  \n       1.13 ┤│  \n       1.00 ┼╯  ',
      '\n    description',
      '',
    ],
    res: {description: 'description', elements: [1,2,3], title: 'title'},
  },
  {
    args: {data: 'elements'},
    description: 'A flat chart is labeled with its amount, not a rounded one',
    expected: [
      '',
      '       0.43 ┼── \n       0.40 ┤   \n       0.37 ┤   \n       0.34 ┤   \n       0.32 ┤   \n       0.29 ┤   \n       0.26 ┤   \n       0.23 ┤   \n       0.20 ┤   \n       0.17 ┤   \n       0.14 ┤   \n       0.11 ┤   \n       0.09 ┤   \n       0.06 ┤   \n       0.03 ┤   \n       0.00 ┤   ',
      '',
    ],
    res: {elements: [0.43, 0.43, 0.43]},
  },
];

tests.forEach(({args, description, error, expected, res}) => {
  return test(description, (t, end) => {
    const loggedErrors = [];
    const loggedInfo = [];

    const logger = {
      error: err => loggedErrors.push(err),
      info: n => loggedInfo.push(n),
    };

    if (!!error) {
      return returnChart({logger ,reject: () => {
        deepEqual(loggedErrors, [{err: error}], 'Error logged as expected');

        return end();
      }})(error);
    }

    return returnChart({
      logger,
      data: args.data,
      resolve: () => {
        deepEqual(
          loggedInfo.join('\n'),
          expected.join('\n'),
          'Got expected info'
        );

        return end();
      },
    })(null, res);
  });
});
