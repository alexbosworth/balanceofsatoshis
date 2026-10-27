const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const {coinbaseProvider} = require('./constants');
const getHistoricRate = require('./get_historic_rate');

/** Get the fiat rate of BTC for an accounting record

  {
    currency: <Currency Type String>
    date: <Record ISO 8601 Date String>
    fiat: <Fiat Type String>
    [get_chain_rate]: <Get Chain Rate Function>
    request: <Request Function>
  }

  @returns via cbk or Promise
  {
    cents: <Cents Per BTC Number>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.request) {
          return cbk([400, 'ExpectedRequestFunctionToGetRecordRate']);
        }

        return cbk();
      },

      // Get the price derived from chain data
      getChainRate: ['validate', ({}, cbk) => {
        // Exit early when there are no chain prices
        if (!args.get_chain_rate) {
          return cbk();
        }

        return args.get_chain_rate({
          currency: args.currency,
          date: args.date,
          fiat: args.fiat,
        },
        cbk);
      }],

      // Get the price at the hour of the record on Coinbase Exchange
      getCoinbaseRate: ['getChainRate', ({getChainRate}, cbk) => {
        // Exit early when the record has a chain price
        if (!!getChainRate) {
          return cbk();
        }

        return getHistoricRate({
          currency: args.currency,
          date: args.date,
          fiat: args.fiat,
          from: coinbaseProvider,
          request: args.request,
        },
        cbk);
      }],

      // The rate of the record
      rate: [
        'getChainRate',
        'getCoinbaseRate',
        ({getChainRate, getCoinbaseRate}, cbk) =>
      {
        return cbk(null, {cents: (getChainRate || getCoinbaseRate).cents});
      }],
    },
    returnResult({reject, resolve, of: 'rate'}, cbk));
  });
};
