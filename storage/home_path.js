const {join} = require('path');

const home = '.bos';

/** Get the path to the home directory

  {
    fs: {
      homeDirectory: () => <Home Directory String>
    }
  }

  @returns
  {
    path: <Path To Home Directory String>
  }
*/
module.exports = ({fs}) => {
  if (!fs) {
    throw new Error('ExpectedFsToDeriveHomePath');
  }

  return {path: join(...[fs.homeDirectory(), home])};
};
