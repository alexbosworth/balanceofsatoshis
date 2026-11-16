const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const asyncMapSeries = require('async/mapSeries');
const {getNetwork} = require('ln-sync');
const moment = require('moment');
const {returnResult} = require('asyncjs-util');

const chainRateMethod = require('./chain_rate_method');
const {dayFormat} = require('./constants');
const {defaultCurrency} = require('./constants');
const {defaultFiat} = require('./constants');
const {fsMethods} = require('./constants');
const {mainnet} = require('./constants');

const dayOf = n => moment.utc(n).format(dayFormat);
const {isArray} = Array;

/** Get the fiat rates of BTC at dates, like accounting records are valued

  {
    dates: [<ISO 8601 Date String>]
    fs: {
      getFile: <Read File Contents Function> (path, cbk) => {}
      makeDirectory: <Make Directory Function> (path, cbk) => {}
      renameFile: <Rename File Function> (from, to, cbk) => {}
      writeFile: <Write File Contents Function> (path, contents, cbk) => {}
    }
    lnds: [<Authenticated LND API Object>]
    [logger]: <Winston Logger Object>
  }

  @returns via cbk or Promise
  {
    fiat: <Fiat Type String>
    rates: [{
      cents: <Cents Per BTC Number>
      date: <ISO 8601 Date String>
    }]
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        const {fs} = args;

        if (!isArray(args.dates)) {
          return cbk([400, 'ExpectedArrayOfDatesToGetFiatRates']);
        }

        if (!fs || !fsMethods.every(n => typeof fs[n] === 'function')) {
          return cbk([400, 'ExpectedFileSystemMethodsToGetFiatRates']);
        }

        if (!isArray(args.lnds) || !args.lnds.length) {
          return cbk([400, 'ExpectedAuthenticatedLndsToGetFiatRates']);
        }

        return cbk();
      },

      // Get the network names of the nodes
      getNetworks: ['validate', ({}, cbk) => {
        return asyncMap(args.lnds, (lnd, cbk) => getNetwork({lnd}, cbk), cbk);
      }],

      // The first date of each day, oldest first, as rates are by the day
      days: ['validate', ({}, cbk) => {
        const sorted = args.dates.slice().sort();

        return cbk(null, sorted.filter((date, i) => {
          return !i || dayOf(date) !== dayOf(sorted[i - 1]);
        }));
      }],

      // The network that the nodes are on
      network: ['getNetworks', ({getNetworks}, cbk) => {
        const [{network}] = getNetworks;

        // Exit early when the nodes are not all on the same network
        if (getNetworks.some(n => n.network !== network)) {
          return cbk([400, 'ExpectedSameNetworkNodesToGetFiatRates']);
        }

        // Only mainnet has chain prices, and rates are not looked up elsewhere
        if (network !== mainnet) {
          return cbk([400, 'ExpectedMainnetNodesToGetFiatRates']);
        }

        return cbk(null, network);
      }],

      // Make the method that gets chain prices
      chain: ['network', ({}, cbk) => {
        // Chain prices are derived through the first node
        const [lnd] = args.lnds;

        return cbk(null, chainRateMethod({
          lnd,
          fs: args.fs,
          logger: args.logger,
        }));
      }],

      // Price days oldest first, the order that chain prices are derived in
      getRates: ['chain', 'days', ({chain, days}, cbk) => {
        return asyncMapSeries(days, (date, cbk) => {
          return chain.getChainRate({
            date,
            currency: defaultCurrency,
            fiat: defaultFiat,
          },
          cbk);
        },
        cbk);
      }],

      // Each date has the rate of its day
      rates: ['days', 'getRates', ({days, getRates}, cbk) => {
        const dayRates = new Map(days.map((date, i) => {
          return [dayOf(date), getRates[i].cents];
        }));

        const rates = args.dates.map(date => {
          return {date, cents: dayRates.get(dayOf(date))};
        });

        return cbk(null, {rates, fiat: defaultFiat});
      }],
    },
    returnResult({reject, resolve, of: 'rates'}, cbk));
  });
};
