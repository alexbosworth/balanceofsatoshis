const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const getAvoidList = require('./../../swaps/get_avoid_list.js');

const makeFs = ({content, err} = {}) => {
  return {getFile: (path, cbk) => cbk(err, Buffer.from(content || ''))};
};

const makeArgs = override => {
  const args = {
    fs: makeFs({content: '\n1x1x1x0\n b \n\na\r\n1x1x1x0\nc'}),
    path: '/tmp/avoid',
  };

  Object.keys(override).forEach(key => args[key] = override[key]);

  return args;
};

const tests = [
  {
    args: makeArgs({fs: undefined}),
    description: 'Filesystem methods are required',
    error: [400, 'ExpectedFilesystemMethodsToGetAvoidList'],
  },
  {
    args: makeArgs({path: undefined}),
    description: 'An avoid list path is required',
    error: [400, 'ExpectedPathToAvoidListFileToGetAvoidList'],
  },
  {
    args: makeArgs({fs: makeFs({err: new Error('Failed to read')})}),
    description: 'A read error is returned',
    error: [503, 'UnexpectedErrorGettingAvoidListFile'],
  },
  {
    args: makeArgs({fs: makeFs({})}),
    description: 'An empty file has no lines',
    expected: {lines: []},
  },
  {
    args: makeArgs({}),
    description: 'Lines are trimmed, deduplicated, and blanks are removed',
    expected: {lines: ['1x1x1x0', 'b', 'a', 'c']},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(getAvoidList(args), error, 'Got expected error');
    } else {
      const result = await getAvoidList(args);

      deepEqual(result, expected, 'Got expected result');
    }

    return;
  });
});
