const {plot} = require('asciichart');

const height = 15;
const isFlat = data => new Set(data).size === 1;
const newLine = '\n';
const padLen = (lineLen, desc) => (Math.max(0, lineLen - desc.length) + 3) / 2;

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
      logger.error({err});

      return reject();
    }

    // A flat line has no range to label, so it is drawn against zero instead
    const range = isFlat(res[data]) ? {max: Number(), min: Number()} : {};

    const chart = plot(res[data], {height, ...range});

    const [line] = chart.split(newLine);

    if (!!res.title) {
      const padding = ' '.repeat(padLen(line.length, res.title));

      logger.info(`${newLine}${padding}${res.title}`);
    }

    logger.info(String());
    logger.info(chart);

    if (!!res.description) {
      const padding = ' '.repeat(padLen(line.length, res.description));

      logger.info(`${newLine}${padding}${res.description}`);
    }

    logger.info(String());

    return resolve();
  };
};
