const asyncAuto = require('async/auto');
const {broadcastChainTransaction} = require('ln-service');
const {componentsOfTransaction} = require('@alexbosworth/blockchain');
const {returnResult} = require('asyncjs-util');
const {transactionFromComponents} = require('@alexbosworth/blockchain');

const {max} = Math;

/** Publish a signed fallback HTLC transaction of a swap in without paying

  {
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    swap: <Swap In With Signed Fallback Transactions Object>
  }

  @returns via cbk or Promise
  {
    transaction_id: <Fallback HTLC Transaction Id Hex String>
  }
*/
module.exports = ({lnd, logger, swap}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedLndToPublishSwapInFallback']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedLoggerToPublishSwapInFallback']);
        }

        if (!swap || !swap.fallback_transactions) {
          return cbk([400, 'ExpectedSignedSwapToPublishSwapInFallback']);
        }

        return cbk();
      },

      // The fallback with the highest fee rate is the surest to be mined
      fallback: ['validate', ({}, cbk) => {
        const rates = swap.fallbacks.map(n => n.fee_tokens_per_kw);

        const highest = swap.fallbacks.find(fallback => {
          return fallback.fee_tokens_per_kw === max(...rates);
        });

        const signed = swap.fallback_transactions.find(fallback => {
          return fallback.type === highest.type;
        });

        return cbk(null, signed);
      }],

      // Publish the fallback with the signatures that spend the deposits
      publish: ['fallback', ({fallback}, cbk) => {
        const unsigned = componentsOfTransaction({
          transaction: fallback.transaction,
        });

        const {transaction} = transactionFromComponents({
          inputs: unsigned.inputs.map((input, i) => ({
            ...input,
            witness: [fallback.signatures[i]],
          })),
          locktime: unsigned.locktime,
          outputs: unsigned.outputs,
          version: unsigned.version,
        });

        return broadcastChainTransaction({lnd, transaction}, cbk);
      }],

      // Published the fallback HTLC
      published: ['publish', ({publish}, cbk) => {
        logger.info({published_swap_in_fallback: publish.id});

        return cbk(null, {transaction_id: publish.id});
      }],
    },
    returnResult({reject, resolve, of: 'published'}, cbk));
  });
};
