const exitCodeSigint = 130;
const isForceClose = err => !!err && err.name === 'ExitPromptError';

/** Get ask function

  {}

  @returns
  <Interrogation Function>
*/
module.exports = ({}) => {
  return new Promise(async resolve => {
    const inquirer = (await import('inquirer')).default;

    return resolve((n, cbk) => {
      return inquirer.prompt([n])
        .then(res => cbk(res))
        .catch(err => {
          // Exit quietly when the user presses ctrl+c
          if (isForceClose(err)) {
            return process.exit(exitCodeSigint);
          }

          throw err;
        });
    });
  });
};
