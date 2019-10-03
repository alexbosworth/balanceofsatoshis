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

/** Get an accounting report

  {
    category: <Accounting Category Type String>
    [currency]: <Currency Label String>
    [fiat]: <Fiat Type String>
    [is_csv]: <Return CSV Output Bool>
    lnd: <Authenticated LND gRPC API Object>
    [month]: <Month For Report>
    [node]: <Node Name String>
    [rate_provider]: <Rate Provider String>
    [year]: <Year For Report>
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
      if (!args.year && !args.month) {
        return cbk(null, {});
      }

      const after = moment.utc().startOf('year');

      if (!!args.year) {
        after.year(args.year);
      }

      if (!after.isValid()) {
        return cbk([400, 'UnrecognizedFormatForAccountingYear']);
      }

      const end = after.clone();

      if (!!args.month && monthNumbers.indexOf(args.month) !== notFoundIndex) {
        [after, end].forEach(n => n.month(Number(args.month) - monthOffset));
      } else if (!!args.month) {
        [after, end].forEach(n => n.month(args.month));
      }

      if (!!args.month) {
        end.add([args.month].length, 'months');
      } else {
        end.add([after].length, 'years');
      }

      if (!after.isValid()) {
        return cbk([400, 'UnrecognizedFormatForAccountingMonth']);
      }

      after.subtract([after].length, 'millisecond');

      return cbk(null, {
        after: after.toISOString(),
        before: end.toISOString(),
      });
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

      const entries = getAccounting[csvType].split('\n').map(n => {
        return n.split(',').map(val => {
          if (val[0] === '"') {
            return val.slice(1, -1).slice(0, 32);
          }

          return parseFloat(val, 10).toFixed(4);
        });
      });

      const [header] = entries;

      const datedRecords = entries.slice([header].length)
        .sort((a, b) => a[2] > b[2] ? 1 : -1);

      const rows = [].concat([header]).concat(datedRecords);

      return cbk(null, {rows});
    }],
  },
  returnResult({of: 'accounting'}, cbk));
};
