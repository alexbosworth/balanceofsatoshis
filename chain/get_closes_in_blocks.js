const asyncAuto = require('async/auto');
const asyncMapSeries = require('async/mapSeries');
const {returnResult} = require('asyncjs-util');

const getBlockTransactions = require('./get_block_transactions');

const flatten = arr => [].concat(...arr);
const {isArray} = Array;
const uniq = arr => Array.from(new Set(arr));

/** Get close transactions out of the blocks they were confirmed in

  When a block can't be retrieved, its close transactions are not returned

  {
    channels: [{
      close_confirm_height: <Close Confirmed At Height Number>
      close_transaction_id: <Close Transaction Id Hex String>
    }]
    lnd: <Authenticated LND API Object>
  }

  @returns via cbk or Promise
  {
    transactions: [{
      id: <Close Transaction Id Hex String>
      transaction: <Raw Close Transaction Hex String>
    }]
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isArray(args.channels)) {
          return cbk([400, 'ExpectedChannelsToGetClosesInBlocks']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToGetClosesInBlocks']);
        }

        return cbk();
      },

      // Get the close transactions out of each block
      getBlocks: ['validate', ({}, cbk) => {
        // Closes that confirmed in the same block share a single block fetch
        const heights = uniq(args.channels.map(n => n.close_confirm_height));

        return asyncMapSeries(heights, (height, cbk) => {
          const ids = args.channels
            .filter(n => n.close_confirm_height === height)
            .map(n => n.close_transaction_id);

          return getBlockTransactions({
            height,
            ids,
            lnd: args.lnd,
          },
          (err, res) => {
            // Exit early when the block can't be retrieved, leaving it unknown
            if (!!err) {
              return cbk(null, []);
            }

            return cbk(null, res.transactions);
          });
        },
        cbk);
      }],

      // Close transactions found in the blocks
      transactions: ['getBlocks', ({getBlocks}, cbk) => {
        return cbk(null, {transactions: flatten(getBlocks)});
      }],
    },
    returnResult({reject, resolve, of: 'transactions'}, cbk));
  });
};
