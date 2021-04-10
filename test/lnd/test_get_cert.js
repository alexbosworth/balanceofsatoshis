const {test} = require('tap');

const getCert = require('./../../lnd/get_cert');

const os = {
  homedir: () => 'homedir',
  platform: () => 'platform',
  userInfo: () => ({username: 'username'}),
};

const tests = [
  {
    args: {},
    description: 'File system methods are required',
    error: [400, 'ExpectedFileSystemMethodsToGetCertForNode'],
  },
  {
    args: {fs: {getFile: () => {}}},
    description: 'OS methods are required',
    error: [400, 'ExpectedOperatingSystemMethodsToGetCertForNode'],
  },
  {
    args: {os, fs: {getFile: () => {}}, node: 'foo'},
    description: 'A specified node returns no cert',
    expected: {},
  },
  {
    args: {os, fs: {getFile: ({}, cbk) => cbk('err')}},
    description: 'A filesystem error is returned',
    error: [503, 'UnexpectedErrorGettingCertFileData', {err: 'err'}],
  },
  {
    args: {os, fs: {getFile: ({}, cbk) => cbk()}},
    description: 'A file is expected',
    error: [503, 'LndCertNotFoundInDefaultLocation'],
  },
  {
    args: {os, fs: {getFile: ({}, cbk) => cbk(null, Buffer.alloc(1))}},
    description: 'A default cert is returned',
    expected: {cert: 'AA=='},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects}) => {
    if (!!error) {
      rejects(getCert(args), error, 'Got expected error');
    } else {
      const {cert} = await getCert(args);

      equal(cert, expected.cert, 'Got expected cert');
    }

    return end();
  });
});
