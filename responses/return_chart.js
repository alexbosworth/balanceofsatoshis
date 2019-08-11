const {plot} = require('asciichart');

const height = 15;
const padding = '\n               ';

/** Return an output result to a logger in a promise

  {
    data: <Chart Data Attribute String>
    logger: {
      info: <Info Function>
    }
    reject: <Reject Function>
    resolve: <Resolve Function>
  }

  @returns
  <Standard Callback Function> (err, res) => {}
*/
module.exports = ({data, logger, reject, resolve}) => {
  return (err, res) => {
    if (!!err) {
      logger.error(err);

      return reject();
    }

    logger.info(String());
    logger.info(plot(res[data], {height}));

    if (!!res.description) {
      logger.info(`${padding}${res.description}`);
    }

    logger.info(String());

    return resolve();
  };
};
