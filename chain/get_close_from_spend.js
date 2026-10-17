const asyncAuto = require('async/auto');
const {componentsOfTransaction} = require('@alexbosworth/blockchain');
const {idForTransaction} = require('@alexbosworth/blockchain');
const {returnResult} = require('asyncjs-util');

const getSpendingTransaction = require('./get_spending_transaction');

const {isArray} = Array;

/** Get a close transaction by looking up the spend of its funding output

  When the spend is not found or is not the close tx, nothing is returned

  {
    close_confirm_height: <Close Confirmed At Height Number>
    close_transaction_id: <Close Transaction Id Hex String>
    lnd: <Authenticated LND API Object>
    transaction_id: <Funding Transaction Id Hex String>
    transaction_vout: <Funding Transaction Output Index Number>
    transactions: [{
      id: <Transaction Id Hex String>
      [transaction]: <Raw Transaction Hex String>
    }]
  }

  @returns via cbk or Promise
  {
    [id]: <Close Transaction Id Hex String>
    [transaction]: <Raw Close Transaction Hex String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.close_confirm_height) {
          return cbk([400, 'ExpectedCloseConfirmHeightToGetCloseFromSpend']);
        }

        if (!args.close_transaction_id) {
          return cbk([400, 'ExpectedCloseTransactionIdToGetCloseFromSpend']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToGetCloseFromSpend']);
        }

        if (!args.transaction_id) {
          return cbk([400, 'ExpectedFundingTransactionIdToGetCloseFromSpend']);
        }

        if (args.transaction_vout === undefined) {
          return cbk([400, 'ExpectedFundingOutputIndexToGetCloseFromSpend']);
        }

        if (!isArray(args.transactions)) {
          return cbk([400, 'ExpectedTransactionsToGetCloseFromSpend']);
        }

        return cbk();
      },

      // Find the funding output to look for the spend of
      fundingOutput: ['validate', ({}, cbk) => {
        const [fundingTx] = args.transactions
          .filter(n => !!n.transaction)
          .filter(n => n.id === args.transaction_id);

        // Exit early when the funding transaction is not known
        if (!fundingTx) {
          return cbk();
        }

        const {outputs} = componentsOfTransaction({
          transaction: fundingTx.transaction,
        });

        return cbk(null, outputs[args.transaction_vout]);
      }],

      // Get the transaction that spent the funding output
      getSpend: ['fundingOutput', ({fundingOutput}, cbk) => {
        // Exit early when the funding output script is not known
        if (!fundingOutput) {
          return cbk();
        }

        return getSpendingTransaction({
          lnd: args.lnd,
          min_height: args.close_confirm_height,
          output_script: fundingOutput.script,
          transaction_id: args.transaction_id,
          transaction_vout: args.transaction_vout,
        },
        (err, res) => {
          // Exit early when LND can't find the spend, leaving it unknown
          if (!!err) {
            return cbk();
          }

          return cbk(null, res.transaction);
        });
      }],

      // The spend is the close transaction when it has the close tx id
      close: ['getSpend', ({getSpend}, cbk) => {
        // Exit early when the spend was not found
        if (!getSpend) {
          return cbk(null, {});
        }

        const {id} = idForTransaction({transaction: getSpend});

        // Exit early when the spend is not the expected close tx
        if (id !== args.close_transaction_id) {
          return cbk(null, {});
        }

        return cbk(null, {id, transaction: getSpend});
      }],
    },
    returnResult({reject, resolve, of: 'close'}, cbk));
  });
};
