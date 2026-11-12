const {feeRateDenominator} = require('./../constants');
const {maxSwapTokens} = require('./../constants');
const {minSwapTokens} = require('./../constants');
const {swapInFastFeeTokens} = require('./../constants');
const {swapInFeeRate} = require('./../constants');
const {swapInFeeTokens} = require('./../constants');
const {swapInUtxoFeeTokens} = require('./../constants');

const {ceil} = Math;
const isWithinTerms = n => !!n && n >= minSwapTokens && n <= maxSwapTokens;

/** Quote the cost of a swap in

  {
    [is_fast]: <Swap Is Requested Fast Bool>
    tokens: <Swap Tokens Number>
    [utxos_count]: <Swap Deposit Utxos Count Number>
  }

  @throws
  <Error>

  @returns
  {
    fee: <Swap Fee Tokens Number>
  }
*/
module.exports = args => {
  if (!isWithinTerms(args.tokens)) {
    throw new Error('ExpectedSwapTokensWithinTermsToQuoteSwapIn');
  }

  const fast = !!args.is_fast ? swapInFastFeeTokens : Number();
  const rate = ceil(args.tokens * swapInFeeRate / feeRateDenominator);
  const utxos = (args.utxos_count || Number()) * swapInUtxoFeeTokens;

  return {fee: swapInFeeTokens + rate + utxos + fast};
};
