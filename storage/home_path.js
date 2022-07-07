const {homedir} = require('os');
const {join} = require('path');

const home = join(...[homedir(), '.bos']);

/** Get the path of the bos storage directory
  @returns
  {
    home: <Home directory path String>
  }
*/
module.exports = ({}) => {
  return process.env.BOS_DIRECTORY || home;
};
