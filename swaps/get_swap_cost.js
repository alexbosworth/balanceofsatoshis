const asyncAuto = require('async/auto');
const {getHeight} = require('ln-service');
const {getSwapInQuote} = require('goldengate');
const {getSwapInTerms} = require('goldengate');
const {getSwapOutQuote} = require('goldengate');
const {getSwapOutTerms} = require('goldengate');
const moment = require('moment');
const {returnResult} = require('asyncjs-util');

const {balanceFromTokens} = require('./../balances');
const {cltvDeltaBuffer} = require('./constants');
const {fastDelayMinutes} = require('./constants');
const {slowDelayMinutes} = require('./constants');

/** Get the cost of liquidity via swap

  {
    [above]: <Cost Above Tokens Number>
    [is_fast]: <Swap Out Is Immediate Bool>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    metadata: <Authentication Metadata Object>
    tokens: <Liquidity Tokens Number>
    type: <Liquidity Type String>
  }

  @returns via cbk or Promise
  {
    cost: <Cost of Swap in Tokens Number>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToGetSwapCost']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToGetSwapCost']);
        }

        if (!args.metadata) {
          return cbk([400, 'ExpectedServiceMetadataToGetSwapCost']);
        }

        if (!args.service) {
          return cbk([400, 'ExpectedSwapServiceToGetSwapCost']);
        }

        if (!args.tokens) {
          return cbk([400, 'ExpectedTokensCountToGetSwapCost']);
        }

        if (!args.type) {
          return cbk([400, 'ExpectedLiquidityTypeToGetSwapCost']);
        }

        return cbk();
      },

      // Get swap terms
      getTerms: ['validate', ({}, cbk) => {
        switch (args.type) {
        case 'inbound':
          return getSwapOutTerms({
            metadata: args.metadata,
            service: args.service,
          },
          cbk);

        case 'outbound':
          return getSwapInTerms({
            metadata: args.metadata,
            service: args.service,
          },
          cbk);

        default:
          return cbk([400, 'GotUnexpectedSwapTypeWhenGettingSwapCost']);
        }
      }],

      // Get the current height
      getHeight: ['getTerms', ({}, cbk) => getHeight({lnd: args.lnd}, cbk)],

      // Get a swap quote
      getQuote: ['getHeight', 'getTerms', ({getHeight, getTerms}, cbk) => {
        const cltv = getTerms.max_cltv_delta + getHeight.current_block_height;
        const swapDelay = !args.is_fast ? slowDelayMinutes : fastDelayMinutes;

        switch (args.type) {
        case 'inbound':
          return getSwapOutQuote({
            delay: moment().add(swapDelay, 'minutes').toISOString(),
            metadata: args.metadata,
            service: args.service,
            timeout: cltv - cltvDeltaBuffer,
            tokens: args.tokens,
          },
          cbk);

        case 'outbound':
          return getSwapInQuote({
            metadata: args.metadata,
            service: args.service,
            tokens: args.tokens,
          },
          cbk);

        default:
          return cbk([400, 'GotUnexpectedSwapTypeWhenGettingSwapCost']);
        }
      }],

      // Final cost
      cost: ['getQuote', 'getTerms', ({getQuote, getTerms}, cbk) => {
        const quote = getQuote;
        const terms = getTerms;

        if (args.tokens > terms.max_tokens) {
          return cbk([400, 'AmountExceedsMaximum', {max: terms.max_tokens}]);
        }

        if (args.tokens < terms.min_tokens) {
          return cbk([400, 'AmountBelowMinimumSwap', {min: terms.min_tokens}]);
        }

        const {fee} = quote;

        return cbk(null, {
          cost: balanceFromTokens({above: args.above, tokens: [fee]})
        });
      }],
    },
    returnResult({reject, resolve, of: 'cost'}, cbk));
  });
};
