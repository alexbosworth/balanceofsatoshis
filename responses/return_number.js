/** Return a count result to a logger in a promise

  {
    logger: {
      info: <Info Function>
    }
    number: <Number Attribute String>
    reject: <Reject Function>
    resolve: <Resolve Function>
  }

  @returns
  <Standard Callback Function> (err, res) => {}
*/
module.exports = ({logger, number, reject, resolve}) => {
  return (err, res) => {
    if (!!err) {
      logger.error(err);

      return reject();
    }

    logger.info(`${res[number]}`);

    return resolve();
  };
};
