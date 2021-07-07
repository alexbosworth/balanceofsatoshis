const {test} = require('@alexbosworth/tap');

const getSocket = require('./../../lnd/get_socket');

const os = {
  homedir: () => 'homedir',
  platform: () => 'platform',
  userInfo: () => ({username: 'username'}),
};

const tests = [
  {
    args: {},
    description: 'File system methods are required',
    error: [400, 'ExpectedFilesystemMethodsToGetSocketInfoForNode'],
  },
  {
    args: {fs: {getFile: ({}, cbk) => {}}},
    description: 'Operating system methods are required',
    error: [400, 'ExpectedOperatingSystemMethodsToGetNodeSocket'],
  },
  {
    args: {os, fs: {getFile: ({}, cbk) => cbk()}, node: 'node'},
    description: 'Specifying a node returns undefined socket',
    expected: {},
  },
  {
    args: {os, fs: {getFile: ({}, cbk) => cbk()}},
    description: 'No conf file returns undefined socket',
    expected: {},
  },
  {
    args: {os, fs: {getFile: ({}, cbk) => cbk(null, Buffer.from(''))}},
    description: 'Invalid ini file returns undefined socket',
    expected: {},
  },
  {
    args: {os, fs: {getFile: ({}, cbk) => cbk(null, Buffer.from('attr=val'))}},
    description: 'No tlsextraip returns undefined socket',
    expected: {},
  },
  {
    args: {
      os,
      fs: {
        getFile: ({}, cbk) => cbk(
          null,
          Buffer.from('[Application Options]\ntlsextraip=ip')
        ),
      },
    },
    description: 'No rpclisten port returns undefined socket',
    expected: {},
  },
  {
    args: {
      os,
      fs: {
        getFile: ({}, cbk) => cbk(
          null,
          Buffer.from(
            [
              '[Application Options]',
              'rpclisten=0.0.0.0:1',
              'tlsextradomain=domain',
            ].join('\n'),
          )
        ),
      },
    },
    description: 'Ip and rpclisten returns a domain',
    expected: {socket: 'domain:1'},
  },
  {
    args: {
      os,
      fs: {
        getFile: ({}, cbk) => cbk(
          null,
          Buffer.from(
            [
              '[Application Options]',
              'rpclisten=0.0.0.0:1',
              'tlsextradomain=lksdjlajdsflkj.onion:1009',
            ].join('\n'),
          )
        ),
      },
    },
    description: 'Onion address returns no socket',
    expected: {},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects}) => {
    if (!!error) {
      rejects(getSocket(args), error, 'Got expected error');
    } else {
      const {socket} = await getSocket(args);

      equal(socket, expected.socket, 'Got expected socket');
    }

    return end();
  });
});
