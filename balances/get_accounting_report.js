const asyncAuto = require('async/auto');
const {chainRates} = require('@alexbosworth/fiat');
const {getAccountingReport} = require('ln-accounting');
const {getNetwork} = require('ln-sync');
const {returnResult} = require('asyncjs-util');

const categories = require('./accounting_categories');
const {chainPricesFile} = require('./constants');
const {coinbaseProvider} = require('./constants');
const {defaultCurrency} = require('./constants');
const {defaultFiat} = require('./constants');
const {fsMethods} = require('./constants');
const getRecordRate = require('./get_record_rate');
const guardChainRate = require('./guard_chain_rate');
const {homePath} = require('./../storage');
const {mainnet} = require('./constants');
const {monthNumbers} = require('./constants');
const {monthOffset} = require('./constants');
const {notFoundIndex} = require('./constants');
const rangeForDate = require('./range_for_date');
const tableRowsFromCsv = require('./table_rows_from_csv');

const assetType = 'BTC';
const currentDate = new Date().toISOString();
const empty = '';
const round = n => parseFloat(n).toFixed(2);
const sumOf = arr => arr.reduce((sum, n) => sum + n, 0);
const summaryHeadings = ['Total', 'Asset', 'Report Date', 'Total Fiat'];

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
    lnd: <Authenticated LND API Object>
    [logger]: <Winston Logger Object>
    [month]: <Month for Report String>
    [node]: <Node Name String>
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
          return cbk([400, 'ExpectedKnownAccountingRecordsCategory']);
        }

        if (!!args.date && !args.month) {
          return cbk([400, 'ExpectedMonthForDateToGetAccountingReport']);
        }

        if (!!fs && !fsMethods.every(n => typeof fs[n] === 'function')) {
          return cbk([400, 'ExpectedFileSystemMethodsToGetAccountingReport']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToGetAccountingReport']);
        }

        if (!args.request) {
          return cbk([400, 'ExpectedRequestFunctionToGetAccountingReport']);
        }

        return cbk();
      },

      // Get date range
      dateRange: ['validate', ({}, cbk) => {
        const range = (() => {
          try {
            return {
              value: rangeForDate({
                date: args.date,
                month: args.month,
                year: args.year,
              }),
            };
          } catch (err) {
            return {err};
          }
        })();

        // Exit early when the date range cannot be determined
        if (!!range.err) {
          return cbk([400, range.err.message]);
        }

        return cbk(null, range.value);
      }],

      // Get the network name
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd: args.lnd}, cbk)],

      // Make the method that gets chain prices, used without a rate provider
      chain: ['getNetwork', ({getNetwork}, cbk) => {
        // Exit early when fiat is disabled or a rate provider is specified
        if (!!args.is_fiat_disabled || !!args.rate_provider) {
          return cbk();
        }

        // Exit early when there are no chain prices for the network or no
        // file system to keep them in
        if (!args.fs || getNetwork.network !== mainnet) {
          return cbk();
        }

        // Progress is only logged when it cannot end up in CSV output
        const logger = !args.is_csv ? args.logger : undefined;

        const {getChainRate} = chainRates({
          logger,
          fs: args.fs,
          lnd: args.lnd,
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

      // Get accounting info
      getAccounting: [
        'dateRange',
        'getNetwork',
        'rate',
        ({dateRange, getNetwork, rate}, cbk) =>
      {
        return getAccountingReport({
          after: dateRange.after,
          before: dateRange.before,
          category: categories[args.category],
          currency: args.currency || defaultCurrency,
          fiat: !args.is_fiat_disabled ? (args.fiat || defaultFiat) : null,
          lnd: args.lnd,
          network: getNetwork.network,
          rate: !!rate ? rate.rate : undefined,
          rate_provider: !rate ? args.rate_provider : undefined,
          request: args.request,
        },
        cbk);
      }],

      // Convert the accounting CSV into rows for table display output
      accounting: ['getAccounting', ({getAccounting}, cbk) => {
        const csvType = `${categories[args.category]}_csv`;

        // Exit early when a CSV dump is requested
        if (!!args.is_csv) {
          return cbk(null, getAccounting[csvType]);
        }

        return tableRowsFromCsv({csv: getAccounting[csvType]}, cbk);
      }],

      // Calculate total amounts
      total: ['getAccounting', ({getAccounting}, cbk) => {
        // Exit early when a CSV dump is requested
        if (!!args.is_csv) {
          return cbk();
        }

        const rows = getAccounting[categories[args.category]];

        // Token values are represented as amounts
        const tokens = sumOf(rows.map(n => n.amount));

        // Exit early when there is no fiat data
        if (!!args.is_fiat_disabled) {
          return cbk(null, {tokens, fiat: empty});
        }

        // Fiat values are represented as fiat amounts
        const fiat = round(sumOf(rows.map(n => n.fiat_amount)));

        return cbk(null, {fiat, tokens});
      }],

      // Clean rows for display if necessary
      report: ['accounting', 'total',({accounting, total}, cbk) => {
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
          [total.tokens, assetType, currentDate, total.fiat],
        ];

        return cbk(null, {rows, rows_summary: summary});
      }],
    },
    returnResult({reject, resolve, of: 'report'}, cbk));
  });
};
