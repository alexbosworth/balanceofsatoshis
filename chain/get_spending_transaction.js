const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');
const {subscribeToChainSpend} = require('ln-service');

const defaultTimeoutMs = 1000 * 10;

/** Get the transaction that spent an output using the LND chain notifier

  When the spend is not found before the timeout, no transaction is returned

  {
    lnd: <Authenticated LND API Object>
    min_height: <Look For The Spend Starting At Block Height Number>
    output_script: <Spent Output Script Hex String>
    [timeout]: <Stop Looking For The Spend After Milliseconds Number>
    transaction_id: <Spent Output Transaction Id Hex String>
    transaction_vout: <Spent Output Transaction Output Index Number>
  }

  @returns via cbk or Promise
  {
    [transaction]: <Raw Spending Transaction Hex String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToGetSpendingTransaction']);
        }

        if (!args.min_height) {
          return cbk([400, 'ExpectedMinHeightToGetSpendingTransaction']);
        }

        if (!args.output_script) {
          return cbk([400, 'ExpectedOutputScriptToGetSpendingTransaction']);
        }

        if (!args.transaction_id) {
          return cbk([400, 'ExpectedTransactionIdToGetSpendingTransaction']);
        }

        if (args.transaction_vout === undefined) {
          return cbk([400, 'ExpectedTransactionVoutToGetSpendingTransaction']);
        }

        return cbk();
      },

      // Wait for LND to find the spend of the output
      getSpend: ['validate', ({}, cbk) => {
        const sub = subscribeToChainSpend({
          lnd: args.lnd,
          min_height: args.min_height,
          output_script: args.output_script,
          transaction_id: args.transaction_id,
          transaction_vout: args.transaction_vout,
        });

        const finished = (err, res) => {
          clearTimeout(timer);

          sub.removeAllListeners();

          return cbk(err, res);
        };

        // Stop looking when the spend is not found in time
        const timer = setTimeout(() => {
          return finished(null, {});
        },
        args.timeout || defaultTimeoutMs);

        sub.once('confirmation', ({transaction}) => {
          return finished(null, {transaction});
        });

        sub.once('end', () => finished(null, {}));

        sub.once('error', err => {
          return finished([503, 'UnexpectedErrorGettingSpend', {err}]);
        });
      }],
    },
    returnResult({reject, resolve, of: 'getSpend'}, cbk));
  });
};
