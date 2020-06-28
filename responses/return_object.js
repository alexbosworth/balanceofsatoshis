const {getBorderCharacters} = require('table');
const renderTable = require('table').table;
const updateNotifier = require('update-notifier');

const pkg = require('./../package.json');
const writeJsonFile = require('./write_json_file');

const border = getBorderCharacters('norc');
const emptyCell = ' ';
const notifier = updateNotifier({pkg});

/** Return an object result to a logger in a promise

  A write method is required if file is passed

  {
    [exit]: <Final Exit Function>
    [file]: <Write Result to JSON At Path String>
    logger: {
      info: <Info Function>
    }
    reject: <Reject Function>
    resolve: <Resolve Function>
    [table]: <Show as Table From Result Attribute String>
    [write]: (path, data, (err) => {})
  }

  @returns
  <Standard Callback Function> (err, res) => {}
*/
module.exports = ({exit, file, logger, reject, resolve, table, write}) => {
  return (err, res) => {
    if (!!err) {
      logger.error({err});

      return reject();
    }

    if (!!file) {
      return writeJsonFile({file, write, json: res}, err => {
        if (!!err) {
          return reject(err);
        }

        return resolve();
      });
    }

    // Exit early when the table is empty
    if (!!table && res[table].length === [table].length) {
      const [header] = res[table];

      logger.info(renderTable([header, header.map(n => emptyCell)], {border}));

      return resolve();
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

    try {
      notifier.notify({isGlobal: true});
    } catch (err) {
      // Suppress errors on version notify issues
    }

    if (!!exit) {
      exit();
    }

    return resolve();
  };
};
