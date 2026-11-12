const asyncAuto = require('async/auto');
const asyncify = require('async/asyncify');
const asyncMap = require('async/map');
const asyncMapSeries = require('async/mapSeries');
const {chainRates} = require('@alexbosworth/fiat');
const {getAccountingReport} = require('ln-accounting');
const {getNetwork} = require('ln-sync');
const {harmonize} = require('ln-accounting');
const moment = require('moment');
const {returnResult} = require('asyncjs-util');

const categories = require('./accounting_categories');
const {chainBlocksFile} = require('./constants');
const {chainPricesFile} = require('./constants');
const chainPricesLogger = require('./chain_prices_logger');
const {coinbaseProvider} = require('./constants');
const {dayFormat} = require('./constants');
const {defaultCurrency} = require('./constants');
const {defaultFiat} = require('./constants');
const {fsMethods} = require('./constants');
const getRecordRate = require('./get_record_rate');
const guardChainRate = require('./guard_chain_rate');
const {homePath} = require('./../storage');
const {mainnet} = require('./constants');
const rangeForDate = require('./range_for_date');
const {sortBy} = require('./../arrays');
const {summaryHeadings} = require('./constants');
const tableRowsFromCsv = require('./table_rows_from_csv');

const assetType = 'BTC';
const dayOf = n => moment.utc(n).format(dayFormat);
const empty = '';
const flatten = arr => [].concat(...arr);
const {isArray} = Array;
const {keys} = Object;
const lastDayBefore = n => moment.utc(n).subtract(1, 'ms').format(dayFormat);
const round = n => parseFloat(n).toFixed(2);
const sumOf = arr => arr.reduce((sum, n) => sum + n, 0);

/** Get an accounting report

  {
    category: <Accounting Category Type String>
    [currency]: <Currency Label String>
    [date]: <Day of Month String>
    [fiat]: <Fiat Type String>
    [fs]: {
      getFile: <Read File Contents Function> (path, cbk) => {}
      makeDirectory: <Make Directory Function> (path, cbk) => {}
      renameFile: <Rename File Function> (from, to, cbk) => {}
      writeFile: <Write File Contents Function> (path, contents, cbk) => {}
    }
    [is_csv]: <Return CSV Output Bool>
    [is_fiat_disabled]: <Omit Fiat Conversion Bool>
    lnds: [<Authenticated LND API Object>]
    [logger]: <Winston Logger Object>
    [month]: <Month for Report String>
    [rate_provider]: <Rate Provider String>
    request: <Request Function>
    [year]: <Year for Report String>
  }

  @returns via cbk or Promise
  {
    [rows]: [[<Column String>]]
    [rows_summary]: [[<Column String>]]
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Validate
      validate: cbk => {
        const {fs} = args;

        if (!args.category || !categories[args.category]) {
          return cbk([400, 'ExpectedKnownAccountingRecordsCategory', {
            categories: keys(categories),
          }]);
        }

        if (!!args.date && !args.month) {
          return cbk([400, 'ExpectedMonthForDateToGetAccountingReport']);
        }

        if (!!fs && !fsMethods.every(n => typeof fs[n] === 'function')) {
          return cbk([400, 'ExpectedFileSystemMethodsToGetAccountingReport']);
        }

        if (!isArray(args.lnds) || !args.lnds.length) {
          return cbk([400, 'ExpectedAuthenticatedLndsToGetAccountingReport']);
        }

        if (!args.request) {
          return cbk([400, 'ExpectedRequestFunctionToGetAccountingReport']);
        }

        return cbk();
      },

      // Get date range
      dateRange: ['validate', asyncify(() => {
        try {
          return rangeForDate({
            date: args.date,
            month: args.month,
            year: args.year,
          });
        } catch (err) {
          throw [400, err.message];
        }
      })],

      // Get the network names of the nodes
      getNetworks: ['validate', ({}, cbk) => {
        return asyncMap(args.lnds, (lnd, cbk) => getNetwork({lnd}, cbk), cbk);
      }],

      // The network that the nodes are on
      network: ['getNetworks', ({getNetworks}, cbk) => {
        const [{network}] = getNetworks;

        // Exit early when the nodes are not all on the same network
        if (getNetworks.some(n => n.network !== network)) {
          return cbk([400, 'ExpectedSameNetworkNodesForAccountingReport']);
        }

        return cbk(null, network);
      }],

      // Make the method that gets chain prices, used without a rate provider
      chain: ['network', ({network}, cbk) => {
        // Exit early when fiat is disabled or a rate provider is specified
        if (!!args.is_fiat_disabled || !!args.rate_provider) {
          return cbk();
        }

        // Exit early when there are no chain prices for the network or no
        // file system to keep them in
        if (!args.fs || network !== mainnet) {
          return cbk();
        }

        // Progress is only logged when it cannot end up in CSV output
        const {logger} = chainPricesLogger({
          logger: !args.is_csv ? args.logger : undefined,
        });

        // Chain prices are derived through the first node
        const [lnd] = args.lnds;

        const {getChainRate} = chainRates({
          lnd,
          logger,
          blocks_path: homePath({file: chainBlocksFile}).path,
          fs: args.fs,
          path: homePath({file: chainPricesFile}).path,
        });

        return cbk(null, guardChainRate({getChainRate}));
      }],

      // Without a rate provider, records are valued with chain prices, and
      // at their hour on Coinbase Exchange when chain prices cannot value them
      rate: ['chain', ({chain}, cbk) => {
        // Exit early when fiat is disabled
        if (!!args.is_fiat_disabled) {
          return cbk();
        }

        // Exit early when a rate provider other than Coinbase is specified
        if (!!args.rate_provider && args.rate_provider !== coinbaseProvider) {
          return cbk();
        }

        return cbk(null, {
          rate: (record, cbk) => getRecordRate({
            currency: record.currency,
            date: record.date,
            fiat: record.fiat,
            get_chain_rate: !!chain ? chain.getChainRate : undefined,
            request: args.request,
          },
          cbk),
        });
      }],

      // Get the accounting records of each node, one node after another
      getAccounting: [
        'dateRange',
        'network',
        'rate',
        ({dateRange, network, rate}, cbk) =>
      {
        return asyncMapSeries(args.lnds, (lnd, cbk) => {
          return getAccountingReport({
            lnd,
            network,
            after: dateRange.after,
            before: dateRange.before,
            category: categories[args.category],
            currency: args.currency || defaultCurrency,
            fiat: !args.is_fiat_disabled ? (args.fiat || defaultFiat) : null,
            rate: !!rate ? rate.rate : undefined,
            rate_provider: !rate ? args.rate_provider : undefined,
            request: args.request,
          },
          cbk);
        },
        cbk);
      }],

      // The records of all of the nodes in the category, in order of date
      records: ['getAccounting', ({getAccounting}, cbk) => {
        const category = categories[args.category];

        const records = flatten(getAccounting.map(report => report[category]));

        const {sorted} = sortBy({array: records, attribute: 'created_at'});

        return cbk(null, sorted);
      }],

      // Convert the records into a CSV, or into rows for table display output
      accounting: ['records', ({records}, cbk) => {
        const {csv} = harmonize({records});

        // Exit early when a CSV dump is requested
        if (!!args.is_csv) {
          return cbk(null, csv);
        }

        return tableRowsFromCsv({csv}, cbk);
      }],

      // Calculate total amounts
      total: ['records', ({records}, cbk) => {
        // Exit early when a CSV dump is requested
        if (!!args.is_csv) {
          return cbk();
        }

        // Token values are represented as amounts
        const tokens = sumOf(records.map(n => n.amount));

        // Exit early when there is no fiat data
        if (!!args.is_fiat_disabled) {
          return cbk(null, {tokens, fiat: empty});
        }

        // Fiat values are represented as fiat amounts
        const fiat = round(sumOf(records.map(n => n.fiat_amount)));

        return cbk(null, {fiat, tokens});
      }],

      // Clean rows for display if necessary
      report: [
        'accounting',
        'dateRange',
        'total',
        ({accounting, dateRange, total}, cbk) =>
      {
        // Exit early when there is no cleaning necessary
        if (!!args.is_csv) {
          return cbk(null, accounting);
        }

        const [header] = accounting.rows;

        const fiatIndex = header.findIndex(row => row === 'Fiat Amount');

        const rows = accounting.rows.map((row, i) => {
          return row.map((col, j) => {
            if (!i) {
              return col;
            }

            if (j === fiatIndex && !!col) {
              return round(col);
            }

            return col.substring(0, 32);
          });
        });

        const summary = [
          summaryHeadings,
          [
            total.tokens,
            assetType,
            new Date().toISOString(),
            total.fiat,
            args.category,
            !dateRange.after ? empty : dayOf(dateRange.after),
            !dateRange.before ? empty : lastDayBefore(dateRange.before),
          ],
        ];

        return cbk(null, {rows, rows_summary: summary});
      }],
    },
    returnResult({reject, resolve, of: 'report'}, cbk));
  });
};
