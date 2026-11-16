const {chainRates} = require('@alexbosworth/fiat');

const {chainBlocksFile} = require('./constants');
const {chainPricesFile} = require('./constants');
const chainPricesLogger = require('./chain_prices_logger');
const {homePath} = require('./../storage');

/** Make a method that gets the fiat rate of BTC from chain derived prices

  {
    fs: {
      getFile: <Read File Contents Function> (path, cbk) => {}
      makeDirectory: <Make Directory Function> (path, cbk) => {}
      renameFile: <Rename File Function> (from, to, cbk) => {}
      writeFile: <Write File Contents Function> (path, contents, cbk) => {}
    }
    lnd: <Authenticated LND API Object>
    [logger]: <Winston Logger Object>
  }

  @throws
  <Error>

  @returns
  {
    getChainRate: <Get Chain Rate Method> ({
      currency: <Currency To Price String>
      date: <Date To Price ISO 8601 Date String>
      fiat: <Fiat Currency To Price In String>
    }, cbk) => (err, {
      cents: <US Cents Per BTC Number>
    })
  }
*/
module.exports = ({fs, lnd, logger}) => {
  return chainRates({
    fs,
    lnd,
    blocks_path: homePath({file: chainBlocksFile}).path,
    logger: chainPricesLogger({logger}).logger,
    path: homePath({file: chainPricesFile}).path,
  });
};
