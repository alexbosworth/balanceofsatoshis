const {test} = require('@alexbosworth/tap');

const writeJsonFile = require('./../../responses/write_json_file');

const tests = [
  {
    args: {},
    description: 'A file is required',
    error: [400, 'ExpectedPathToWriteJsonFile'],
  },
  {
    args: {file: 'file'},
    description: 'JSON is required',
    error: [400, 'ExpectedJsonToWriteToJsonFile'],
  },
  {
    args: {file: 'file', json: {foo: 'bar'}},
    description: 'JSON is required',
    error: [400, 'ExpectedWriteMethodToWriteToJsonFile'],
  },
  {
    args: {
      file: 'file',
      json: {foo: 'bar'},
      write: (file, data, cbk) => cbk('err'),
    },
    description: 'Write errors are reported',
    error: [503, 'FailedToWriteJsonToFile', {err: 'err'}],
  },
  {
    args: {file: 'file', json: {foo: 'bar'}},
    description: 'JSON is required',
    expected: {
      file: 'file',
      data: `{\n  "foo": "bar"\n}`,
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects}) => {
    if (!!error) {
      rejects(writeJsonFile(args), error, 'Got expected err');

      return end();
    }

    args.write = (file, data, cbk) => {
      equal(file, expected.file, 'Got expected file path');
      equal(data, expected.data, 'Got expected file data');

      return cbk();
    };

    await writeJsonFile(args);

    return;
  });
});
