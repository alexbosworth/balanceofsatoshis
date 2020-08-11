const asyncAuto = require('async/auto');
const {getSwapInQuote} = require('goldengate');
const {getSwapInTerms} = require('goldengate');
const {getSwapOutQuote} = require('goldengate');
const {getSwapOutTerms} = require('goldengate');
const {getWalletInfo} = require('ln-service');
const moment = require('moment');
const {returnResult} = require('asyncjs-util');

const {balanceFromTokens} = require('./../balances');
const {cltvDeltaBuffer} = require('./constants');
const {fastDelayMinutes} = require('./constants');
const getPaidService = require('./get_paid_service');
const {slowDelayMinutes} = require('./constants');

/** Get the cost of liquidity via swap

  {
    [above]: <Cost Above Tokens Number>
    [api_key]: <CBOR API Key Hex Encoded String>
    [is_fast]: <Swap Out Is Immediate Bool>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    service: <Swap Service API Object>
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

      // Get paid service
      getService: ['validate', ({}, cbk) => {
        // Exit early when there is no API key with the vanilla service
        if (!args.api_key) {
          return cbk(null, {service: args.service});
        }

        return getPaidService({
          lnd: args.lnd,
          logger: args.logger,
          token: args.api_key,
        },
        cbk);
      }],

      // Get swap terms
      getTerms: ['getService', ({getService}, cbk) => {
        switch (args.type) {
        case 'inbound':
          return getSwapOutTerms({
            macaroon: getService.macaroon,
            preimage: getService.preimage,
            service: getService.service,
          },
          cbk);

        case 'outbound':
          return getSwapInTerms({
            macaroon: getService.macaroon,
            preimage: getService.preimage,
            service: getService.service,
          },
          cbk);

        default:
          return cbk([400, 'GotUnexpectedSwapTypeWhenGettingSwapCost']);
        }
      }],

      // Get the current height
      getHeight: ['getTerms', ({}, cbk) => {
        return getWalletInfo({lnd: args.lnd}, cbk);
      }],

      // Get a swap quote
      getQuote: [
        'getHeight',
        'getService',
        'getTerms',
        ({getHeight, getService, getTerms}, cbk) =>
      {
        const cltv = getTerms.max_cltv_delta + getHeight.current_block_height;
        const swapDelay = !args.is_fast ? slowDelayMinutes : fastDelayMinutes;

        switch (args.type) {
        case 'inbound':
          return getSwapOutQuote({
            delay: moment().add(swapDelay, 'minutes').toISOString(),
            macaroon: getService.macaroon,
            preimage: getService.preimage,
            service: getService.service,
            timeout: cltv - cltvDeltaBuffer,
            tokens: args.tokens,
          },
          cbk);

        case 'outbound':
          return getSwapInQuote({
            macaroon: getService.macaroon,
            preimage: getService.preimage,
            service: getService.service,
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
