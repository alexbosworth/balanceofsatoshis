const {test} = require('tap');

const lndDirectory = require('./../../lnd/lnd_directory');

const tests = [
  {
    args: {},
    description: 'Operating system methods are required',
    error: 'ExpectedOperatingSytemMethodsToDetermineLndDirectory',
  },
  {
    args: {os: {}},
    description: 'Homedir method is required',
    error: 'ExpectedHomedirFunctionToDetermineLndDirectory',
  },
  {
    args: {os: {homedir: () => 'homedir'}},
    description: 'Platform method is required',
    error: 'ExpectedPlatformFunctionToDetermineLndDirectory',
  },
  {
    args: {os: {homedir: () => 'homedir', platform: () => 'darwin'}},
    description: 'Mac directory is returned',
    expected: {path: 'homedir/Library/Application Support/Lnd'},
  },
  {
    args: {os: {homedir: () => 'homedir', platform: () => 'win32'}},
    description: 'Windows directory is returned',
    expected: {path: 'homedir/AppData/Local/Lnd'},
  },
  {
    args: {os: {homedir: () => 'homedir', platform: () => 'linux'}},
    description: 'Linux directory is returned',
    expected: {path: 'homedir/.lnd'},
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
