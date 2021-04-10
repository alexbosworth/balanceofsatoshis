const {join} = require('path');

const platforms = require('./platforms');

const umbrelPath = '/home/umbrel/umbrel/lnd';
const umbrelUser = 'umbrel';

/** LND directory path

  {
    os: {
      homedir: <Home Directory Function> () => <Home Directory Path String>
      platform: <Platform Function> () => <Platform Name String>
      userInfo: () => {username: <User Name String>}
    }
  }

  @throws
  <Error>

  @returns
  {
    path: <LND Directory Path String>
  }
*/
module.exports = ({os}) => {
  if (!os) {
    throw new Error('ExpectedOperatingSytemMethodsToDetermineLndDirectory');
  }

  if (!os.homedir) {
    throw new Error('ExpectedHomedirFunctionToDetermineLndDirectory');
  }

  if (!os.platform) {
    throw new Error('ExpectedPlatformFunctionToDetermineLndDirectory');
  }

  if (!os.userInfo) {
    throw new Error('ExpectedUserInfoFunctionToDetermineLndDirectory');
  }

  // The default directory on Umbrel is not the normal path
  try {
    if (os.userInfo().username === umbrelUser) {
      return {path: umbrelPath};
    }
  } catch {} // Ignore errors

  switch (os.platform()) {
  case platforms.macOS:
    return {path: join(os.homedir(), 'Library', 'Application Support', 'Lnd')};

  case platforms.windows:
    return {path: join(os.homedir(), 'AppData', 'Local', 'Lnd')};

  default:
    return {path: join(os.homedir(), '.lnd')};
  }
};
