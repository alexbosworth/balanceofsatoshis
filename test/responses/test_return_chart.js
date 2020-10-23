const {test} = require('tap');

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
];

tests.forEach(({args, description, error, expected, res}) => {
  return test(description, ({deepIs, end, equal, throws}) => {
    const loggedErrors = [];
    const loggedInfo = [];

    const logger = {
      error: err => loggedErrors.push(err),
      info: n => loggedInfo.push(n),
    };

    if (!!error) {
      return returnChart({logger ,reject: () => {
        deepIs(loggedErrors, [{err: error}], 'Error logged as expected');

        return end();
      }})(error);
    }

    return returnChart({
      logger,
      data: args.data,
      resolve: () => {
        deepIs(loggedInfo.join('\n'), expected.join('\n'), 'Got expected info');

        return end();
      },
    })(null, res);
  });
});
