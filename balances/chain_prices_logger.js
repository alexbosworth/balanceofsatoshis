const chainPriceRange = require('./chain_price_range');
const {chainPriceFlagNotes} = require('./constants');

const {floor} = Math;
const {keys} = Object;
const msPerDay = 1000 * 60 * 60 * 24;

/** Make a logger that describes deriving prices from chain data

  {
    [logger]: <Winston Logger Object>
  }

  @returns
  {
    [logger]: {
      error: <Error Function>
      info: <Info Function>
    }
  }
*/
module.exports = ({logger}) => {
  // Exit early when there is no logger to describe progress with
  if (!logger) {
    return {};
  }

  return {
    logger: {
      error: err => logger.error(err),
      info: line => {
        // Exit early describing fetching blocks as calculating prices
        if (!!line && !!line.fetching_blocks) {
          const {blocks, date} = line.fetching_blocks;

          const days = floor((Date.now() - Date.parse(date)) / msPerDay);

          const isToday = days === 0;

          return logger.info({
            calculating_prices_from_blocks: {
              blocks,
              day: date,
              days_out_of_date: !isNaN(days) && !isToday ? days : undefined,
            },
          });
        }

        // Exit early when the line is not a price derived from chain data
        if (!line || !line.chain_price || !line.chain_price.price) {
          return logger.info(line);
        }

        const price = line.chain_price;

        const flags = keys(chainPriceFlagNotes).filter(flag => !!price[flag]);

        const note = flags.map(flag => chainPriceFlagNotes[flag]).join(', ');

        // Only a price from a full day of blocks has the measures behind it
        const isFullDay = price.outputs !== undefined;

        // Keys are in reading order, the price first and then its evidence
        return logger.info({
          chain_price: {
            date: price.date,
            price: price.price,
            price_range: isFullDay ? chainPriceRange(price).range : undefined,
            blocks: isFullDay ? price.blocks : undefined,
            payment_outputs: isFullDay ? price.outputs : undefined,
            round_dollar_payments: isFullDay ? price.payments : undefined,
            note: note || undefined,
          },
        });
      },
    },
  };
};
