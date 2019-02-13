const asyncAuto = require('async/auto');
const {getChainBalance} = require('ln-service');
const {getChannelBalance} = require('ln-service');
const {getPendingChainBalance} = require('ln-service');
const {lightningDaemon} = require('ln-service');

const {lndCredentials} = require('./../lnd');
const {returnResult} = require('./../async');

const credentials = lndCredentials({});
const {max} = Math;
const noTokens = 0;

/** Get the existing balance

  {
    [above]: <Tokens Above Tokens Number>
    [below]: <Tokens Below Tokens Number>
    [is_offchain_only]: <Get Only Channels Tokens Bool>
    [is_onchain_only]: <Get Only Chain Tokens Bool>
  }

  @returns via cbk
  {
    balance: <Tokens Number>
  }
*/
module.exports = (args, cbk) => {
  return asyncAuto({
    // Lnd
    lnd: cbk => {
      return cbk(null, lightningDaemon({
        cert: credentials.cert,
        macaroon: credentials.macaroon,
        socket: credentials.socket,
      }));
    },

    // Get the chain balance
    getChainBalance: ['lnd', ({lnd}, cbk) => getChainBalance({lnd}, cbk)],

    // Get the channel balance
    getChannelBalance: ['lnd', ({lnd}, cbk) => getChannelBalance({lnd}, cbk)],

    // Get the pending balance
    getPending: ['lnd', ({lnd}, cbk) => getPendingChainBalance({lnd}, cbk)],

    // Total balances
    balance: [
      'getChainBalance',
      'getChannelBalance',
      'getPending',
      ({getChainBalance, getChannelBalance, getPending}, cbk) =>
    {
      const balances = [
        !!args.is_offchain_only ? noTokens : getChainBalance.chain_balance,
        !!args.is_onchain_only ? noTokens : getChannelBalance.channel_balance,
        !!args.is_onchain_only ? noTokens : getChannelBalance.pending_balance,
        !!args.is_offchain_only ? noTokens : getPending.pending_chain_balance,
      ];

      const total = balances.reduce((sum, n) => n + sum, noTokens);

      if (!!args.above) {
        const above = total > args.above ? total - args.above : noTokens;

        return cbk(null, {balance: above});
      }

      if (!!args.below) {
        const below = total < args.below ? args.below - total : noTokens;

        return cbk(null, {balance: below});
      }

      return cbk(null, {balance: total});
    }],
  },
  returnResult({of: 'balance'}, cbk));
};
