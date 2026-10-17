const asyncAuto = require('async/auto');
const {getBlock} = require('ln-service');
const {queryTransactions} = require('@alexbosworth/blockchain');
const {returnResult} = require('asyncjs-util');

const defaultTimeoutMs = 1000 * 10;
const {isArray} = Array;
const isHash = n => /^[0-9A-F]{64}$/i.test(n);

/** Get transactions in a block by their ids using the LND chain backend

  When the block is not retrieved before the timeout, no txs are returned

  {
    height: <Block Height Number>
    ids: [<Transaction Id Hex String>]
    lnd: <Authenticated LND API Object>
    [timeout]: <Stop Waiting For The Block After Milliseconds Number>
  }

  @returns via cbk or Promise
  {
    transactions: [{
      id: <Transaction Id Hex String>
      transaction: <Raw Transaction Hex String>
    }]
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.height) {
          return cbk([400, 'ExpectedBlockHeightToGetBlockTransactions']);
        }

        if (!isArray(args.ids) || !args.ids.length) {
          return cbk([400, 'ExpectedTransactionIdsToGetBlockTransactions']);
        }

        if (!!args.ids.find(n => !isHash(n))) {
          return cbk([400, 'ExpectedTransactionIdHexStringsToGetBlockTxs']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToGetBlockTransactions']);
        }

        return cbk();
      },

      // Get the block from LND, giving up when it takes too long
      getBlock: ['validate', ({}, cbk) => {
        let isFinished = false;

        const finished = (err, res) => {
          // Exit early when the result was already returned
          if (isFinished) {
            return;
          }

          isFinished = true;

          clearTimeout(timer);

          return cbk(err, res);
        };

        // Stop waiting when the block is not retrieved in time
        const timer = setTimeout(() => {
          return finished(null, {});
        },
        args.timeout || defaultTimeoutMs);

        return getBlock({height: args.height, lnd: args.lnd}, finished);
      }],

      // Find the transactions in the block
      transactions: ['getBlock', ({getBlock}, cbk) => {
        // Exit early when there is no block to look through
        if (!getBlock.block) {
          return cbk(null, {transactions: []});
        }

        try {
          const {transactions} = queryTransactions({
            block: getBlock.block,
            ids: args.ids,
          });

          return cbk(null, {transactions});
        } catch (err) {
          return cbk([503, 'UnexpectedErrorParsingBlockTransactions', {err}]);
        }
      }],
    },
    returnResult({reject, resolve, of: 'transactions'}, cbk));
  });
};
