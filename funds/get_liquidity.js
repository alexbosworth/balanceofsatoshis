const asyncAuto = require('async/auto');
const {getChannels} = require('ln-service');
const {lightningDaemon} = require('ln-service');

const {balanceFromTokens} = require('./../balances');
const {lndCredentials} = require('./../lnd');
const {returnResult} = require('./../async');

const noTokens = 0;

/** Get the channel available inbound liquidity

  {
    [above]: <Tokens Above Tokens Number>
    [below]: <Tokens Below Tokens Number>
    [node]: <Node Name String>
  }

  @returns via cbk
  {
    balance: <Liquid Tokens Number>
  }
*/
module.exports = ({above, below, node}, cbk) => {
  return asyncAuto({
    // Credentials
    credentials: cbk => lndCredentials({node}, cbk),

    // Lnd
    lnd: ['credentials', ({credentials}, cbk) => {
      return cbk(null, lightningDaemon({
        cert: credentials.cert,
        macaroon: credentials.macaroon,
        socket: credentials.socket,
      }));
    }],

    // Get the channels
    getChannels: ['lnd', ({lnd}, cbk) => getChannels({lnd}, cbk)],

    // Total balances
    total: ['getChannels', ({getChannels}, cbk) => {
      const activeChannels = getChannels.channels.filter(n => !!n.is_active);

      const tokens = activeChannels.map(n => n.remote_balance);

      try {
        const balance = balanceFromTokens({above, below, tokens});

        return cbk(null, balance);
      } catch (err) {
        return cbk([500, 'FailedToCalculateLiquidityBalance', err]);
      }
    }],

    // Liquidity
    liquidity: ['total', ({total}, cbk) => {
      return cbk(null, {balance: total});
    }],
  },
  returnResult({of: 'liquidity'}, cbk));
};
