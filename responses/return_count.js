/** Return a count result to a logger in a promise

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

    const {balance} = res;

    logger.info(`${balance}`);

    return resolve();
  };
};
