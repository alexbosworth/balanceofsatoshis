const asyncAuto = require('async/auto');
const {getAccountingReport} = require('ln-accounting');
const {getNetwork} = require('ln-sync');
const {returnResult} = require('asyncjs-util');

const categories = require('./accounting_categories');
const {defaultCurrency} = require('./constants');
const {defaultFiat} = require('./constants');
const {monthNumbers} = require('./constants');
const {monthOffset} = require('./constants');
const {notFoundIndex} = require('./constants');
const rangeForDate = require('./range_for_date');
const tableRowsFromCsv = require('./table_rows_from_csv');
const renderTable = require('table').table;

let totalAmount = 0;
let totalColumns = [];
let totalFiatAmount = 0;
let totalValues = [];

/** Get an accounting report

  {
    category: <Accounting Category Type String>
    [currency]: <Currency Label String>
    [fiat]: <Fiat Type String>
    [is_csv]: <Return CSV Output Bool>
    [is_fiat_disabled]: <Omit Fiat Conversion Bool>
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

        if(!args.logger) {
          return cbk([400, 'ExpectedLoggerToGetAccountingReport']);
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

      // Get the network name
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd: args.lnd}, cbk)],

      // Get accounting info
      getAccounting: [
        'dateRange',
        'getNetwork',
        ({dateRange, getNetwork}, cbk) =>
      {
        return getAccountingReport({
          after: dateRange.after,
          before: dateRange.before,
          category: categories[args.category],
          currency: args.currency || defaultCurrency,
          fiat: !args.is_fiat_disabled ? (args.fiat || defaultFiat) : null,
          lnd: args.lnd,
          network: getNetwork.network,
          rate_provider: args.rate_provider || undefined,
          request: args.request,
        },
        cbk);
      }],
      
      // Calculate total amount
      getTotal: ['getAccounting', ({getAccounting}, cbk) => {
        // Exit early when a CSV dump is requested
        if(!!args.is_csv) {
          return cbk();
        }

        //Calculate total sats
        totalAmount = getAccounting[categories[args.category]].reduce(function (sum, total) {
          return sum + total.amount;
        }, 0);

        //Calculate total fiat amount
        if(!args.is_fiat_disabled) {
          totalFiatAmount = getAccounting[categories[args.category]].reduce(function (sum, total) {
            return sum + total.fiat_amount;
          }, 0);
          totalFiatAmount = Math.round(totalFiatAmount * 100) / 100
        }

      return cbk(null, {totalAmount, totalFiatAmount});
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

      // Clean rows for display if necessary
      report: ['accounting', 'getTotal',({accounting, getTotal}, cbk) => {
        // Exit early when there is no cleaning necessary
        if (!!args.is_csv) {
          return cbk(null, accounting);
        }
        
        const [header] = accounting.rows;

        const fiatIndex = header.findIndex(row => row === 'Fiat Amount');

        let rows = accounting.rows.map((row, i) => {
          return row.map((col, j) => {
            if (!i) {
              return col;
            }

            if (j === fiatIndex && !!col) {
              return parseFloat(col).toFixed(2);
            }

            return col.substring(0, 32);
          });
        });

        if(!!args.is_fiat_disabled) {
          totalColumns = ['Total', 'Asset'];
          totalValues = [getTotal.totalAmount, 'BTC'];
        } else {
          totalColumns = ['Total', 'Asset', '                       ', 'Total Fiat'];
          totalValues = [getTotal.totalAmount, 'BTC', '', getTotal.totalFiatAmount];
        }

        const totalTable  = [totalColumns, totalValues];
        args.logger.info(renderTable(rows));
        args.logger.info(renderTable(totalTable));

        return cbk();
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
