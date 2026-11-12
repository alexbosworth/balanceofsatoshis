const {feeRateDenominator} = require('./../constants');
const {maxSwapTokens} = require('./../constants');
const {minSwapTokens} = require('./../constants');
const {swapDepositTokens} = require('./../constants');
const {swapFeeRate} = require('./../constants');
const {swapFeeTokens} = require('./../constants');

const {ceil} = Math;
const isWithinTerms = n => !!n && n >= minSwapTokens && n <= maxSwapTokens;

/** Quote the cost of a swap out

  {
    public_key: <Swap Server Public Key Hex String>
    tokens: <Swap Tokens Number>
  }

  @throws
  <Error>

  @returns
  {
    deposit: <Swap Deposit Tokens Number>
    destination: <Swap Payment Destination Public Key Hex String>
    fee: <Swap Fee Tokens Number>
  }
*/
module.exports = args => {
  if (!args.public_key) {
    throw new Error('ExpectedServerPublicKeyToQuoteSwapOut');
  }

  if (!isWithinTerms(args.tokens)) {
    throw new Error('ExpectedSwapTokensWithinTermsToQuoteSwapOut');
  }

  return {
    deposit: swapDepositTokens,
    destination: args.public_key,
    fee: swapFeeTokens + ceil(args.tokens * swapFeeRate / feeRateDenominator),
  };
};
