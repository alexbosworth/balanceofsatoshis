const {test} = require('@alexbosworth/tap');

const lndDirectory = require('./../../lnd/lnd_directory');

const userInfo = () => ({username: 'username'});

const tests = [
  {
    args: {},
    description: 'Operating system methods are required',
    error: 'ExpectedOperatingSytemMethodsToDetermineLndDirectory',
  },
  {
    args: {os: {userInfo}},
    description: 'Homedir method is required',
    error: 'ExpectedHomedirFunctionToDetermineLndDirectory',
  },
  {
    args: {os: {userInfo, homedir: () => 'homedir'}},
    description: 'Platform method is required',
    error: 'ExpectedPlatformFunctionToDetermineLndDirectory',
  },
  {
    args: {os: {homedir: () => 'homedir', platform: () => 'darwin'}},
    description: 'userInfo method is required',
    error: 'ExpectedUserInfoFunctionToDetermineLndDirectory',
  },
  {
    args: {os: {userInfo, homedir: () => 'homedir', platform: () => 'darwin'}},
    description: 'Mac directory is returned',
    expected: {path: 'homedir/Library/Application Support/Lnd'},
  },
  {
    args: {os: {userInfo, homedir: () => 'homedir', platform: () => 'win32'}},
    description: 'Windows directory is returned',
    expected: {path: 'homedir/AppData/Local/Lnd'},
  },
  {
    args: {os: {userInfo, homedir: () => 'homedir', platform: () => 'linux'}},
    description: 'Linux directory is returned',
    expected: {path: 'homedir/.lnd'},
  },
  {
    args: {
      os: {
        homedir: () => 'homedir',
        platform: () => 'linux',
        userInfo: () => { throw 'Error'},
      },
    },
    description: 'Regular directory is returned',
    expected: {path: 'homedir/.lnd'},
  },
  {
    args: {
      os: {
        homedir: () => 'homedir',
        platform: () => 'linux',
        userInfo: () => ({username: 'umbrel'}),
      },
    },
    description: 'Umbrel directory is returned',
    expected: {path: '/home/umbrel/umbrel/lnd'},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, throws}) => {
    if (!!error) {
      throws(() => lndDirectory(args), new Error(error), 'Got expected error');
    } else {
      const {path} = await lndDirectory(args);

      equal(path, expected.path, 'Got expected path');
    }

    return end();
  });
});
