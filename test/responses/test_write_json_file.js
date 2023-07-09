const {equal} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

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
  return test(description, async () => {
    if (!!error) {
      await rejects(writeJsonFile(args), error, 'Got expected err');
    } else {
      args.write = (file, data, cbk) => {
        equal(file, expected.file, 'Got expected file path');
        equal(data, expected.data, 'Got expected file data');

        return cbk();
      };

      await writeJsonFile(args);
    }

    return;
  });
});
