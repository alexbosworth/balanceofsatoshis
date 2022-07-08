const {homedir} = require('os');
const {join} = require('path');

const home = join(...[homedir(), '.bos']);

/** Get the path of the bos storage directory

  {
    file: <File Name String>
  }

  @returns
  {
    path: <Home Directory Path String>
  }
*/
module.exports = ({file}) => {
  const dir = process.env.BOS_DATA_PATH || home;

  return {path: join(...[dir, file].filter(n => !!n))};
};
