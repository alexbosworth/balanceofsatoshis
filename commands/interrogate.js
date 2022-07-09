/** Get ask function

  {}

  @returns
  <Interrogation Function>
*/
module.exports = ({}) => {
  return new Promise(async resolve => {
    const inquirer = (await import('inquirer')).default;

    return resolve((n, cbk) => inquirer.prompt([n]).then(res => cbk(res)));
  });
};
