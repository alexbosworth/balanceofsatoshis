const asyncAuto = require('async/auto');
const {getAccountingReport} = require('ln-accounting');
const moment = require('moment');
const {returnResult} = require('asyncjs-util');

const categories = require('./accounting_categories');
const {defaultCurrency} = require('./constants');
const {defaultFiat} = require('./constants');
const {monthNumbers} = require('./constants');
const {monthOffset} = require('./constants');
const {notFoundIndex} = require('./constants');
const rangeForDate = require('./range_for_date');
const tableRowsFromCsv = require('./table_rows_from_csv');

/** Get an accounting report

  {
    category: <Accounting Category Type String>
    [currency]: <Currency Label String>
    [fiat]: <Fiat Type String>
    [is_csv]: <Return CSV Output Bool>
    lnd: <Authenticated LND gRPC API Object>
    [month]: <Month for Report String>
    [node]: <Node Name String>
    [rate_provider]: <Rate Provider String>
    request: <Request Function>
    [year]: <Year for Report String>
  }

  @returns via cbk or Promise
  {
    [rows]: [[<Column String>]]
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Validate
      validate: cbk => {
        if (!args.category || !categories[args.category]) {
          return cbk([400, 'ExpectedKnownAccountingRecordsCategory']);
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
        try {
          return cbk(null, rangeForDate({month: args.month, year: args.year}));
        } catch (err) {
          return cbk([400, err.message]);
        }
      }],

      // Get accounting info
      getAccounting: ['dateRange', ({dateRange}, cbk) => {
        return getAccountingReport({
          after: dateRange.after,
          before: dateRange.before,
          category: categories[args.category],
          currency: args.currency || defaultCurrency,
          fiat: args.fiat || defaultFiat,
          lnd: args.lnd,
          rate_provider: args.rate_provider || undefined,
          request: args.request,
        },
        cbk);
      }],

      // Accounting
      accounting: ['getAccounting', ({getAccounting}, cbk) => {
        const csvType = `${categories[args.category]}_csv`;

        // Exit early when a CSV dump is requested
        if (!!args.is_csv) {
          return cbk(null, getAccounting[csvType]);
        }

        return tableRowsFromCsv({csv: getAccounting[csvType]}, cbk);
      }],

      // Clean rows for display if necessary
      report: ['accounting', ({accounting}, cbk) => {
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

            if (j === fiatIndex) {
              return parseFloat(col).toFixed(2);
            }

            return col.substring(0, 32);
          });
        });

        return cbk(null, {rows});
      }],
    },
    returnResult({reject, resolve, of: 'report'}, cbk));
  });
};
