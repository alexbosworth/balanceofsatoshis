const {join} = require('path');

const platforms = require('./platforms');

/** LND directory path

  {
    os: {
      homedir: <Home Directory Function> () => <Home Directory Path String>
      platform: <Platform Function> () => <Platform Name String>
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

  switch (os.platform()) {
  case platforms.macOS:
    return {path: join(os.homedir(), 'Library', 'Application Support', 'Lnd')};

  case platforms.windows:
    return {path: join(os.homedir(), 'AppData', 'Local', 'Lnd')};

  default:
    return {path: join(os.homedir(), '.lnd')};
  }
};
