const {homedir} = require('os');
const {join} = require('path');
const {platform} = require('os');

const platforms = require('./platforms');

/** LND directory path

  {}

  @returns
  {
    path: <LND Directory Path String>
  }
*/
module.exports = ({}) => {
  switch (platform()) {
  case platforms.macOS:
    return {path: join(homedir(), 'Library', 'Application Support', 'Lnd')};

  default:
    return {path: join(homedir(), '.lnd')};
  }
};
