const asyncAuto = require('async/auto');
const {authenticatedLndGrpc} = require('ln-service');
const {getAccountingReport} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const categories = require('./accounting_categories');
const {lndCredentials} = require('./../lnd');

const defaultCurrency = 'BTC';
const defaultFiat = 'USD';

/** Get an accounting report

  {
    category: <Accounting Category Type String>
    [currency]: <Currency Label String>
    [fiat]: <Fiat Type String>
    [is_csv]: <Return CSV Output Bool>
    [node]: <Node Name String>
  }

  @returns via cbk
  {
    [rows]: [[<Column String>]]
  }
*/
module.exports = (args, cbk) => {
  return asyncAuto({
    // Credentials
    credentials: cbk => lndCredentials({node: args.node}, cbk),

    // Validate
    validate: cbk => {
      if (!args.category || !categories[args.category]) {
        return cbk([400, 'ExpectedKnownAccountingRecordsCategory']);
      }

      return cbk();
    },

    // Lnd
    lnd: ['credentials', 'validate', ({credentials}, cbk) => {
      return cbk(null, authenticatedLndGrpc({
        cert: credentials.cert,
        macaroon: credentials.macaroon,
        socket: credentials.socket,
      }).lnd);
    }],

    // Get accounting info
    getAccounting: ['lnd', ({lnd}, cbk) => {
      return getAccountingReport({
        lnd,
        category: categories[args.category],
        currency: args.currency || defaultCurrency,
        fiat: args.fiat || defaultFiat,
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
