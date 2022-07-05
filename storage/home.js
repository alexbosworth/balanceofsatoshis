const home = '.bos';

/** Get the name of the home directory
  @returns
  {
    home: <Home directory name String>
  }
*/
module.exports = () => {

  return process.env.BOS_DIRECTORY || home;
};
