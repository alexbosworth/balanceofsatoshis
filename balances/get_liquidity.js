const asyncAuto = require('async/auto');
const {getChannels} = require('ln-service');
const {getLiquidity} = require('ln-sync');
const {getNetwork} = require('ln-sync');
const {getNode} = require('ln-service');
const {getScoredNodes} = require('ln-sync');
const {returnResult} = require('asyncjs-util');

const balanceFromTokens = require('./balance_from_tokens');
const liquidityTokens = require('./liquidity_tokens');

const {round} = Math;
const topPercentile = 0.9;

/** Get the channel available liquidity

  A request function is required when min_node_score is specified

  {
    [above]: <Tokens Above Tokens Number>
    [below]: <Tokens Below Tokens Number>
    [is_outbound]: <Return Outbound Liquidity Bool>
    [is_top]: <Return Top Liquidity Bool>
    lnd: <Authenticated LND gRPC API Object>
    [min_node_score]: <Minimum Node Score Number>
    [max_fee_rate]: <Max Inbound Fee Rate Parts Per Million Number>
    [request]: <Request Function>
    [with]: <Liquidity With Specific Node Public Key Hex String>
  }

  @returns via cbk
  {
    balance: <Liquid Tokens Number>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!!args.is_outbound && args.max_fee_rate !== undefined) {
          return cbk([400, 'MaxLiquidityFeeRateNotSupportedForOutbound']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToGetLiquidity']);
        }

        if (!!args.min_node_score && !args.request) {
          return cbk([400, 'ExpectedRequestFunctionToFilterByNodeScore']);
        }

        return cbk();
      },

      // Get liquidity
      getLiquidity: ['validate', ({}, cbk) => {
        return getLiquidity({
          is_outbound: args.is_outbound,
          is_top: args.is_top,
          lnd: args.lnd,
          min_node_score: args.min_node_score,
          request: args.request,
          with: args.with,
        },
        cbk);
      }],

      // Total balances
      total: ['getLiquidity', ({getLiquidity}, cbk) => {
        return cbk(null, {
          balance: balanceFromTokens({
            above: args.above,
            below: args.below,
            tokens: getLiquidity.tokens,
          }),
        });
      }],
    },
    returnResult({reject, resolve, of: 'total'}, cbk));
  });
};
