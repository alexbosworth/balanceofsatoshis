const asyncAuto = require('async/auto');
const {getChainBalance} = require('ln-service');
const {getChannelBalance} = require('ln-service');
const {getPendingChainBalance} = require('ln-service');
const {lightningDaemon} = require('ln-service');

const {lndCredentials} = require('./../lnd');
const {returnResult} = require('./../async');

const credentials = lndCredentials({});

/** Get the existing balance

  {}

  @returns via cbk
  {
    balance: <Tokens Number>
  }
*/
module.exports = ({}, cbk) => {
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
        getChainBalance.chain_balance,
        getChannelBalance.channel_balance,
        getChannelBalance.pending_balance,
        getPending.pending_chain_balance,
      ];

      return cbk(null, {balance: balances.reduce((sum, n) => n + sum, 0)});
    }],
  },
  returnResult({of: 'balance'}, cbk));
};
