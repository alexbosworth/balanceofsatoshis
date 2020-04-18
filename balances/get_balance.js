const asyncAuto = require('async/auto');
const {getChainBalance} = require('ln-service');
const {getChannelBalance} = require('ln-service');
const {getChannels} = require('ln-service');
const {getPendingChainBalance} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const balanceFromTokens = require('./balance_from_tokens');

const {max} = Math;
const none = 0;

/** Get the existing balance

  {
    [above]: <Tokens Above Tokens Number>
    [below]: <Tokens Below Tokens Number>
    [is_confirmed]: <Is Confirmed Funds Bool>
    [is_offchain_only]: <Get Only Channels Tokens Bool>
    [is_onchain_only]: <Get Only Chain Tokens Bool>
    lnd: <Authenticated LND gRPC API Object>
  }

  @returns via cbk
  {
    balance: <Tokens Number>
    channel_balance: <Channel Balance Minus Commit Fees Tokens Number>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToGetBalance']);
        }

        return cbk();
      },

      // Lnd object
      lnd: ['validate', ({}, cbk) => cbk(null, args.lnd)],

      // Get the chain balance
      getChainBalance: ['lnd', ({lnd}, cbk) => getChainBalance({lnd}, cbk)],

      // Get the channel balance
      getChanBalance: ['lnd', ({lnd}, cbk) => getChannelBalance({lnd}, cbk)],

      // Get the initiator burden
      getChannels: ['lnd', ({lnd}, cbk) => getChannels({lnd}, cbk)],

      // Get the pending balance
      getPending: ['lnd', ({lnd}, cbk) => getPendingChainBalance({lnd}, cbk)],

      // Calculate the pending chain sum
      pendingChain: ['getPending', ({getPending}, cbk) => {
        // Exit early when we are only looking at offchain or confirmed funds
        if (!!args.is_offchain_only || !!args.is_confirmed) {
          return cbk(null, none);
        }

        // Exit early when there is no pending chain balance
        if (!getPending.pending_chain_balance) {
          return cbk(null, none);
        }

        return cbk(null, getPending.pending_chain_balance);
      }],

      // Total balances
      balance: [
        'getChainBalance',
        'getChanBalance',
        'getChannels',
        'pendingChain',
        ({getChainBalance, getChanBalance, getChannels, pendingChain}, cbk) =>
      {
        const futureCommitFees = getChannels.channels
          .filter(n => n.is_partner_initiated === false)
          .reduce((sum, n) => sum + n.commit_transaction_fee, 0);

        const pendingChanToks = !!args.is_onchain_only || !!args.is_confirmed ?
            none : getChanBalance.pending_balance;

        // Gather all component balances
        const balances = [
          !!args.is_offchain_only ? none : getChainBalance.chain_balance,
          !!args.is_onchain_only ? none : getChanBalance.channel_balance,
          !!args.is_onchain_only ? none : -futureCommitFees,
          pendingChain,
          pendingChanToks,
        ];

        const balance = balanceFromTokens({
          above: args.above,
          below: args.below,
          tokens: balances,
        });

        return cbk(null, {
          balance,
          channel_balance: getChanBalance.channel_balance - futureCommitFees,
        });
      }],
    },
    returnResult({reject, resolve, of: 'balance'}, cbk));
  });
};
