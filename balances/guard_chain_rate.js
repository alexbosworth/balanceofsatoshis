const {pricesFileErrors} = require('./constants');

const isFileError = err => !!err && pricesFileErrors.includes(err[1]);

/** Make a chain rate lookup that only fails on prices file errors

  {
    getChainRate: <Get Chain Rate Function>
  }

  @returns
  {
    getChainRate: <Get Chain Rate Method> ({
      currency: <Currency To Price String>
      date: <Date To Price ISO 8601 Date String>
      fiat: <Fiat Currency To Price In String>
    }, cbk) => (err, [{
      cents: <US Cents Per BTC Number>
    }])
  }
*/
module.exports = ({getChainRate}) => {
  const failure = {};

  return {
    getChainRate: (args, cbk) => {
      // Exit early when the prices file failed, since it would fail again
      if (!!failure.err) {
        return cbk(failure.err);
      }

      return getChainRate(args, (err, res) => {
        // Exit early when there is a chain price
        if (!err) {
          return cbk(null, res);
        }

        // Exit early without a price when chain prices cannot value the date
        if (!isFileError(err)) {
          return cbk();
        }

        // A prices file error is kept, as trying again cannot fix the file
        failure.err = err;

        return cbk(err);
      });
    },
  };
};
