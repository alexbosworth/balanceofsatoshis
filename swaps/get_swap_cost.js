const asyncAuto = require('async/auto');
const {getSwapInQuote} = require('goldengate');
const {getSwapOutQuote} = require('goldengate');
const {lightningLabsSwapService} = require('goldengate');
const {returnResult} = require('asyncjs-util');

const {balanceFromTokens} = require('./../balances');
const {feeRateDenominator} = require('./constants');
const {getNetwork} = require('./../network');
const {swapTypes} = require('./constants');

/** Get the cost of liquidity via swap

  {
    [above]: <Cost Above Tokens Number>
    service: <Swap Service API Object>
    tokens: <Liquidity Tokens Number>
    type: <Liquidity Type String>
  }

  @returns via cbk or Promise
  {
    cost: <Cost of Swap in Tokens Number>
  }
*/
module.exports = ({above, service, tokens, type}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!service) {
          return cbk([400, 'ExpectedSwapServiceToGetSwapCost']);
        }

        if (!tokens) {
          return cbk([400, 'ExpectedTokensCountToGetSwapCost']);
        }

        return cbk();
      },

      // Get a swap quote
      getQuote: ['validate', ({}, cbk) => {
        switch (type) {
        case 'inbound':
          return getSwapInQuote({service}, cbk);

        case 'outbound':
          return getSwapOutQuote({service}, cbk);

        default:
          return cbk([400, 'GotUnexpectedSwapTypeWhenGettingSwapCost']);
        }
      }],

      // Final cost
      cost: ['getQuote', ({getQuote}, cbk) => {
        const quote = getQuote;

        if (tokens > quote.max_tokens) {
          return cbk([400, 'AmountExceedsMaximum', {max: quote.max_tokens}]);
        }

        if (tokens < quote.min_tokens) {
          return cbk([400, 'AmountBelowMinimumSwap', {min: quote.min_tokens}]);
        }

        const rateFee = quote.fee_rate / feeRateDenominator * tokens;

        const fee = rateFee + quote.base_fee;

        return cbk(null, {cost: balanceFromTokens({above, tokens: [fee]})});
      }],
    },
    returnResult({reject, resolve, of: 'cost'}, cbk));
  });
};
