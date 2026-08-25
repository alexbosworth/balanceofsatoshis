const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const writeAvoidList = require('./../../swaps/write_avoid_list.js');

const temp = `/tmp/avoid.${process.pid}`;

const makeFs = ({renameErr, writeErr} = {}) => {
  const fs = {
    calls: [],
    renameFile: (from, to, cbk) => {
      fs.calls.push({from, to});

      return cbk(renameErr);
    },
    writeFile: (path, contents, cbk) => {
      fs.calls.push({contents, path});

      return cbk(writeErr);
    },
  };

  return fs;
};

const makeArgs = override => {
  const args = {fs: makeFs({}), lines: ['a', 'b'], path: '/tmp/avoid'};

  Object.keys(override).forEach(key => args[key] = override[key]);

  return args;
};

const tests = [
  {
    args: makeArgs({fs: undefined}),
    description: 'Filesystem methods are required',
    error: [400, 'ExpectedFilesystemMethodsToWriteAvoidList'],
  },
  {
    args: makeArgs({lines: undefined}),
    description: 'Avoid lines are required',
    error: [400, 'ExpectedAvoidLinesToWriteAvoidList'],
  },
  {
    args: makeArgs({path: undefined}),
    description: 'An avoid list path is required',
    error: [400, 'ExpectedPathToAvoidListFileToWriteAvoidList'],
  },
  {
    args: makeArgs({fs: makeFs({writeErr: new Error('WriteFailed')})}),
    description: 'A write error is returned',
    error: [503, 'UnexpectedErrorWritingAvoidList'],
  },
  {
    args: makeArgs({fs: makeFs({renameErr: new Error('RenameFailed')})}),
    description: 'A rename error is returned',
    error: [503, 'UnexpectedErrorReplacingAvoidList'],
  },
  {
    args: makeArgs({}),
    calls: [
      {contents: 'a\nb', path: temp},
      {from: temp, to: '/tmp/avoid'},
    ],
    description: 'The list is written to a temp file and swapped in place',
  },
];

tests.forEach(({args, calls, description, error}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(writeAvoidList(args), error, 'Got expected error');
    } else {
      await writeAvoidList(args);

      deepEqual(args.fs.calls, calls, 'Got expected filesystem calls');
    }

    return;
  });
});
