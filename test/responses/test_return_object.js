const {test} = require('@alexbosworth/tap');

const {returnObject} = require('./../../responses');

const {nextTick} = process;

const tests = [
  {
    args: {}, description: 'Error returns an error', error: 'error',
  },
  {
    args: {data: {foo: 'bar'}, file: 'file'},
    description: 'Object is written to file',
  },
  {
    args: {data: {foo: 'bar'}, file: 'file'},
    description: 'Object is written to file',
    error: [503, 'FailedToWriteJsonToFile', {err: 'err'}],
  },
  {
    args: {
      table: [['0A', '0B', '0C'], ['1A', '1B', '1C'], ['2A', '2B', '2C']],
    },
    description: 'Tabular data is output',
    expected: '┌────┬────┬────┐\n│ 0A │ 0B │ 0C │\n├────┼────┼────┤\n│ 1A │ 1B │ 1C │\n├────┼────┼────┤\n│ 2A │ 2B │ 2C │\n└────┴────┴────┘\n',
  },
  {
    args: {res: 1}, description: 'Number res returns a string', expected: '1',
  },
  {
    args: {res: 'string'},
    description: 'String res returns a string',
    expected: 'string',
  },
  {
    args: {exit: true}, description: 'Exit runs exit method',
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, ({end, equal, strictSame}) => {
    let loggedErr;
    let loggedInfo;

    const logger = {
      error: ({err}) => loggedErr = err,
      info: info => loggedInfo = info,
    };

    if (!!args.table) {
      return returnObject({logger, table: 'table', resolve: n => {
        equal(loggedInfo, expected, 'Got expected table output');

        return end();
      }})(null, {table: args.table});
    }

    if (!!args.file && !!error) {
      return nextTick(() => {
        returnObject({
          file: args.file,
          write: (path, data, cbk) => cbk('err'),
          reject: err => {
            strictSame(err, error, 'Got expected file write error');

            return end();
          },
        })(null, args.data);
      });
    }

    if (!!args.file) {
      return nextTick(() => {
        returnObject({
          file: args.file,
          write: (path, data, cbk) => cbk(),
          resolve: () => end(),
        })(null, args.data);
      });
    }

    if (!!error) {
      return returnObject({logger, reject: err => {
        equal(loggedErr, error, 'Error was logged');

        return end();
      }})(error);
    }

    if (!!args.exit) {
      return returnObject({logger, resolve: () => {}, exit: () => end()})(
        null,
        args.res
      );
    }

    return returnObject({logger, resolve: () => {
      equal(loggedInfo, expected);

      return end();
    }})(null, args.res);

    return;
  });
});
