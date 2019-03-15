/** Return an object result to a logger in a promise

  {
    logger: {
      info: <Info Function>
    }
    reject: <Reject Function>
    resolve: <Resolve Function>
  }

  @returns
  <Standard Callback Function> (err, res) => {}
*/
module.exports = ({logger, reject, resolve}) => {
  return (err, res) => {
    if (!!err) {
      return reject(err);
    }

    if (typeof res === 'number') {
      logger.info(`${res}`);
    } else {
      logger.info(res);
    }

    return resolve();
  };
};
