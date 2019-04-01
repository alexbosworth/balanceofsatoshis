const asyncAuto = require('async/auto');
const {getChainBalance} = require('ln-service');
const {getChannelBalance} = require('ln-service');
const {getChannels} = require('ln-service');
const {getPendingChainBalance} = require('ln-service');
const {lightningDaemon} = require('ln-service');

const balanceFromTokens = require('./balance_from_tokens');
const {lndCredentials} = require('./../lnd');
const {returnResult} = require('./../async');

const {max} = Math;
const noTokens = 0;

/** Get the existing balance

  {
    [above]: <Tokens Above Tokens Number>
    [below]: <Tokens Below Tokens Number>
    [is_offchain_only]: <Get Only Channels Tokens Bool>
    [is_onchain_only]: <Get Only Chain Tokens Bool>
    [node]: <Node Name String>
  }

  @returns via cbk
  {
    balance: <Tokens Number>
  }
*/
module.exports = (args, cbk) => {
  return asyncAuto({
    // Credentials
    credentials: cbk => lndCredentials({node: args.node}, cbk),

    // Lnd
    lnd: ['credentials', ({credentials}, cbk) => {
      return cbk(null, lightningDaemon({
        cert: credentials.cert,
        macaroon: credentials.macaroon,
        socket: credentials.socket,
      }));
    }],

    // Get the chain balance
    getChainBalance: ['lnd', ({lnd}, cbk) => getChainBalance({lnd}, cbk)],

    // Get the channel balance
    getChannelBalance: ['lnd', ({lnd}, cbk) => getChannelBalance({lnd}, cbk)],

    // Get the initiator burden
    getChannels: ['lnd', ({lnd}, cbk) => getChannels({lnd}, cbk)],

    // Get the pending balance
    getPending: ['lnd', ({lnd}, cbk) => getPendingChainBalance({lnd}, cbk)],

    // Total balances
    balance: [
      'getChainBalance',
      'getChannelBalance',
      'getChannels',
      'getPending',
      ({getChainBalance, getChannelBalance, getChannels, getPending}, cbk) =>
    {
      const futureCommitFees = getChannels.channels
        .filter(n => n.is_partner_initiated === false)
        .reduce((sum, n) => sum + n.commit_transaction_fee, 0);

      const balances = [
        !!args.is_offchain_only ? noTokens : getChainBalance.chain_balance,
        !!args.is_onchain_only ? noTokens : getChannelBalance.channel_balance,
        !!args.is_onchain_only ? noTokens : getChannelBalance.pending_balance,
        !!args.is_offchain_only ? noTokens : getPending.pending_chain_balance,
        !!args.is_onchain_only ? noTokens : -futureCommitFees,
      ];

      try {
        const balance = balanceFromTokens({
          above: args.above,
          below: args.below,
          tokens: balances,
        });

        return cbk(null, {balance});
      } catch (err) {
        return cbk([500, 'FailedToCalculateBalanceTotal', err]);
      }
    }],
  },
  returnResult({of: 'balance'}, cbk));
};
