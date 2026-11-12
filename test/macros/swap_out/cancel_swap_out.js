const asyncAuto = require('async/auto');
const asyncEach = require('async/each');
const {cancelHodlInvoice} = require('ln-service');
const {returnResult} = require('asyncjs-util');

/** Cancel a swap out that has not been funded on chain

  {
    hash: <Swap Hash Hex String>
    lnd: <Authenticated LND API Object>
    payment: <Funding Invoice Payment Identifier Hex String>
    swaps: <Swaps Keyed By Swap Hash Object>
  }

  @returns via cbk or Promise
*/
module.exports = ({hash, lnd, payment, swaps}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!hash) {
          return cbk([400, 'ExpectedSwapHashToCancelSwapOut']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndToCancelSwapOut']);
        }

        if (!payment) {
          return cbk([400, 'ExpectedPaymentIdentifierToCancelSwapOut']);
        }

        if (!swaps) {
          return cbk([400, 'ExpectedSwapsToCancelSwapOut']);
        }

        return cbk();
      },

      // Find the swap to cancel
      swap: ['validate', ({}, cbk) => {
        const swap = swaps[hash];

        if (!swap) {
          return cbk([400, 'ExpectedKnownSwapToCancelSwapOut']);
        }

        // The payment identifier is only known to the requester of the swap
        if (swap.fund_payment !== payment) {
          return cbk([400, 'ExpectedSwapPaymentIdentifierToCancelSwapOut']);
        }

        // Exit early when the swap funding is already published on chain
        if (!!swap.funding) {
          return cbk([400, 'ExpectedUnpublishedSwapToCancelSwapOut']);
        }

        return cbk(null, swap);
      }],

      // Cancel the deposit and funding invoices to release their payments
      cancel: ['swap', ({swap}, cbk) => {
        return asyncEach([swap.deposit_id, swap.hash], (id, cbk) => {
          return cancelHodlInvoice({id, lnd}, cbk);
        },
        cbk);
      }],

      // Mark the swap as canceled
      canceled: ['cancel', 'swap', ({swap}, cbk) => {
        swap.is_canceled = true;

        return cbk();
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
