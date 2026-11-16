const {recoveryFeeRateMultiple} = require('./constants');
const {recoveryNearFeeRate} = require('./constants');

const {isArray} = Array;
const {max} = Math;
const noFeeRate = 0;
const notFound = -1;

/** Select items near a fee rate, then at each doubling of the fee rate

  {
    [fee_rate]: <Current Fee Tokens Per VByte Number>
    items: [{
      fee_rate: <Fee Tokens Per VByte Number>
    }]
    [near]: <Items Either Side of the Fee Rate Count Number>
  }

  @throws
  <Error>

  @returns
  {
    items: [{
      fee_rate: <Fee Tokens Per VByte Number>
    }]
  }
*/
module.exports = args => {
  if (!isArray(args.items)) {
    throw new Error('ExpectedArrayOfItemsToSelectByFeeRate');
  }

  // Exit early when there are no items to select
  if (!args.items.length) {
    return {items: []};
  }

  const around = args.near === undefined ? recoveryNearFeeRate : args.near;
  const rate = args.fee_rate || noFeeRate;

  const atRate = args.items.findIndex(n => n.fee_rate >= rate);

  // When every item pays less than the current rate, the last items are near
  const index = atRate === notFound ? args.items.length - 1 : atRate;

  const start = max(Number(), index - around);

  // Items around the current fee rate are the most likely to be used
  const near = args.items.slice(start, index + around + 1);

  // Higher items are selected at each doubling in case chain fees spike
  const higher = args.items.slice(start + near.length);

  const doublings = higher.reduce((kept, item) => {
    const [last] = near.concat(kept).reverse();

    // Skip items that do not double the fee rate of the last selected item
    if (item.fee_rate < last.fee_rate * recoveryFeeRateMultiple) {
      return kept;
    }

    return kept.concat(item);
  },
  []);

  const selected = near.concat(doublings);

  const [final] = args.items.slice().reverse();

  // The last item has the highest fee rate
  if (!selected.includes(final)) {
    return {items: selected.concat(final)};
  }

  return {items: selected};
};
