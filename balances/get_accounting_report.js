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
    [year]: <Year for Report String>
  }

  @returns via cbk
  {
    [rows]: [[<Column String>]]
  }
*/
module.exports = (args, cbk) => {
  return asyncAuto({
    // Validate
    validate: cbk => {
      if (!args.category || !categories[args.category]) {
        return cbk([400, 'ExpectedKnownAccountingRecordsCategory']);
      }

      if (!args.lnd) {
        return cbk([400, 'ExpectedAuthenticatedLndToGetAccountingReport']);
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

      const {rows} = tableRowsFromCsv({csv: getAccounting[csvType]});

      return cbk(null, {rows});
    }],
  },
  returnResult({of: 'accounting'}, cbk));
};
