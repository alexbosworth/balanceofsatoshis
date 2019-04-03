const writeJsonFile = require('./write_json_file');

/** Return an object result to a logger in a promise

  {
    [file]: <Write Result to JSON At Path String>
    logger: {
      info: <Info Function>
    }
    reject: <Reject Function>
    resolve: <Resolve Function>
  }

  @returns
  <Standard Callback Function> (err, res) => {}
*/
module.exports = ({file, logger, reject, resolve}) => {
  return (err, res) => {
    if (!!err) {
      return reject(err);
    }

    if (typeof res === 'number') {
      logger.info(`${res}`);
    } else {
      logger.info(res);
    }

    if (!!file) {
      return writeJsonFile({file, json: res}, err => {
        if (!!err) {
          return reject(err);
        }

        return resolve();
      });
    }

    return resolve();
  };
};
