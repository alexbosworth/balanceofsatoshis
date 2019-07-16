const {getBorderCharacters} = require('table');
const renderTable = require('table').table;

const writeJsonFile = require('./write_json_file');

const border = getBorderCharacters('norc');

/** Return an object result to a logger in a promise

  {
    [exit]: <Final Exit Function>
    [file]: <Write Result to JSON At Path String>
    logger: {
      info: <Info Function>
    }
    reject: <Reject Function>
    resolve: <Resolve Function>
    [table]: <Show as Table From Result Attribute String>
  }

  @returns
  <Standard Callback Function> (err, res) => {}
*/
module.exports = ({exit, file, logger, reject, resolve, table}) => {
  return (err, res) => {
    if (!!err) {
      logger.error(err);

      return reject();
    }

    if (!!file) {
      return writeJsonFile({file, json: res}, err => {
        if (!!err) {
          return reject(err);
        }

        return resolve();
      });
    }

    // Exit early when a table output is requested
    if (!!table) {
      logger.info(renderTable(res[table], {border}));

      return resolve();
    }

    if (typeof res === 'number') {
      logger.info(`${res}`);
    } else {
      logger.info(res);
    }

    if (!!exit) {
      exit();
    }

    return resolve();
  };
};
