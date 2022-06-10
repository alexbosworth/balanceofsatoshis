const {test} = require('@alexbosworth/tap');

const getPath = require('./../../lnd/get_path');

const os = {userInfo: () => ({username: 'umbrel'})};

const tests = [
  {
    args: {},
    description: 'File system methods are required',
    error: [400, 'ExpectedFileSystemMethodsToGetPath'],
  },
  {
    args: {fs: {getFile: () => {}}},
    description: 'OS methods are required',
    error: [400, 'ExpectedOperatingSystemMethodsToGetPath'],
  },
  {
    args: {os, fs: {getFile: ({}, cbk) => cbk('err')}},
    description: 'A filesystem error results in no path',
    expected: {path: undefined},
  },
  {
    args: {os, fs: {getFile: ({}, cbk) => cbk()}},
    description: 'An absent file results in no path',
    expected: {path: undefined},
  },
  {
    args: {
      fs: {getFile: ({}, cbk) => cbk()},
      os: {userInfo: () => ({username: 'username'})},
    },
    description: 'A normal user returns no path',
    expected: {path: undefined},
  },
  {
    args: {os, fs: {getFile: ({}, cbk) => cbk(null, Buffer.alloc(1))}},
    description: 'A path is returned',
    expected: {path: '/home/umbrel/umbrel/lnd'},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, rejects, strictSame}) => {
    if (!!error) {
      await rejects(getPath(args), error, 'Got expected error');
    } else {
      const res = await getPath(args);

      strictSame(res, expected, 'Got expected result');
    }

    return end();
  });
});
