const asyncAuto = require('async/auto');
const {getSwapInQuote} = require('goldengate');
const {getSwapInTerms} = require('goldengate');
const {getSwapOutQuote} = require('goldengate');
const {getSwapOutTerms} = require('goldengate');
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
          return getSwapInQuote({service, tokens}, cbk);

        case 'outbound':
          return getSwapOutQuote({service, tokens}, cbk);

        default:
          return cbk([400, 'GotUnexpectedSwapTypeWhenGettingSwapCost']);
        }
      }],

      // Get swap terms
      getTerms: ['validate', ({}, cbk) => {
        switch (type) {
        case 'inbound':
          return getSwapInTerms({service}, cbk);

        case 'outbound':
          return getSwapOutTerms({service}, cbk);

        default:
          return cbk([400, 'GotUnexpectedSwapTypeWhenGettingSwapCost']);
        }
      }],

      // Final cost
      cost: ['getQuote', 'getTerms', ({getQuote, getTerms}, cbk) => {
        const quote = getQuote;
        const terms = getTerms;

        if (tokens > terms.max_tokens) {
          return cbk([400, 'AmountExceedsMaximum', {max: terms.max_tokens}]);
        }

        if (tokens < terms.min_tokens) {
          return cbk([400, 'AmountBelowMinimumSwap', {min: terms.min_tokens}]);
        }

        const {fee} = quote;

        return cbk(null, {cost: balanceFromTokens({above, tokens: [fee]})});
      }],
    },
    returnResult({reject, resolve, of: 'cost'}, cbk));
  });
};
