const {stringify} = JSON;
const spacer = '  ';

/** Return an output result to a logger in a promise

  {
    logger: {
      error: <Log Error Function>
      info: <Log Info Function>
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
      logger.error(err);

      return reject();
    }

    logger.info(stringify(res, null, spacer));

    return resolve();
  };
};
