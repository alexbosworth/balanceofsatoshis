const {test} = require('@alexbosworth/tap');

const getMacaroon = require('./../../lnd/get_macaroon');

const os = {
  homedir: () => 'homedir',
  platform: () => 'platform',
  userInfo: () => ({username: 'username'}),
};

const tests = [
  {
    args: {},
    description: 'File system methods are required',
    error: [400, 'ExpectedFileSystemMethodsToGetMacaroon'],
  },
  {
    args: {fs: {getFile: ({}, cbk) => cbk()}},
    description: 'Operating system methods are required',
    error: [400, 'ExpectedOperatingSystemMethodsToGetMacaroon'],
  },
  {
    args: {os, fs: {getFile: ({}, cbk) => cbk()}, node: 'node'},
    description: 'If a node is specified, no macaroon is returned',
    expected: {},
  },
  {
    args: {os, fs: {getFile: ({}, cbk) => cbk()}},
    description: 'If no macaroon is found, an error is returned',
    error: [503, 'FailedToGetMacaroonFileFromDefaultLocation'],
  },
  {
    args: {os, fs: {getFile: ({}, cbk) => cbk(null, Buffer.alloc(1))}},
    description: 'A macaroon in the default location is returned',
    expected: {macaroon: 'AA=='},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects}) => {
    if (!!error) {
      rejects(getMacaroon(args), error, 'Got expected error');
    } else {
      const {macaroon} = await getMacaroon(args);

      equal(macaroon, expected.macaroon, 'Got expected macaroon');
    }

    return end();
  });
});
