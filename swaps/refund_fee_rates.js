const selectByFeeRate = require('./select_by_fee_rate');

const asRates = n => [...Array(n).keys()].map(i => ({fee_rate: i + 1}));
const {ceil} = Math;
const {isInteger} = Number;

/** Get fee rates to sign refunds at, with higher fee rates unlocking later

  {
    delay_blocks: <Unlock Delay Blocks For Each Doubling Number>
    fee_rate: <Current Fee Tokens Per VByte Number>
    max_multiple: <Highest Fee Rate as a Multiple of the Fee Rate Number>
    near: <Fee Rates Either Side of the Fee Rate Count Number>
  }

  @throws
  <Error>

  @returns
  {
    rates: [{
      delay: <Unlock Delay Blocks Number>
      fee_rate: <Fee Tokens Per VByte Number>
    }]
  }
*/
module.exports = args => {
  if (!isInteger(args.delay_blocks) || args.delay_blocks < 0) {
    throw new Error('ExpectedDelayBlocksToGetRefundFeeRates');
  }

  if (!args.fee_rate || args.fee_rate < 0) {
    throw new Error('ExpectedCurrentFeeRateToGetRefundFeeRates');
  }

  if (!isInteger(args.max_multiple) || args.max_multiple < 1) {
    throw new Error('ExpectedMaxFeeRateMultipleToGetRefundFeeRates');
  }

  if (!isInteger(args.near) || args.near < 0) {
    throw new Error('ExpectedNearFeeRatesCountToGetRefundFeeRates');
  }

  const rate = ceil(args.fee_rate);

  // Refunds are signed at whole fee rates up to a multiple of the fee rate
  const {items} = selectByFeeRate({
    fee_rate: rate,
    items: asRates(rate * args.max_multiple),
    near: args.near,
  });

  // Fee rates near the current fee rate unlock first
  const near = items.filter(n => n.fee_rate <= rate + args.near);

  const first = near.map(n => ({delay: Number(), fee_rate: n.fee_rate}));

  // Each higher fee rate unlocks a delay after the one before it
  const later = items.slice(near.length).map((item, i) => ({
    delay: (i + 1) * args.delay_blocks,
    fee_rate: item.fee_rate,
  }));

  return {rates: first.concat(later)};
};
