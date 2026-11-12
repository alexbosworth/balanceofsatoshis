const {createHash} = require('node:crypto');

const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');
const {settleHodlInvoice} = require('ln-service');

const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const isPreimage = n => !!n && /^[0-9A-F]{64}$/i.test(n);
const sha256 = preimage => createHash('sha256').update(preimage).digest('hex');

/** Push the preimage of a swap out to take the swap funding payment

  {
    lnd: <Authenticated LND API Object>
    preimage: <Swap Preimage Hex String>
    swaps: <Swaps Keyed By Swap Hash Object>
  }

  @returns via cbk or Promise
*/
module.exports = ({lnd, preimage, swaps}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedLndToPushSwapOutPreimage']);
        }

        if (!isPreimage(preimage)) {
          return cbk([400, 'ExpectedPreimageToPushSwapOutPreimage']);
        }

        if (!swaps) {
          return cbk([400, 'ExpectedSwapsToPushSwapOutPreimage']);
        }

        return cbk();
      },

      // Find the swap that the preimage is for
      swap: ['validate', ({}, cbk) => {
        const swap = swaps[sha256(hexAsBuffer(preimage))];

        if (!swap) {
          return cbk([400, 'ExpectedKnownSwapToPushSwapOutPreimage']);
        }

        // Exit early when the swap funding is not published on chain yet
        if (!swap.funding) {
          return cbk([400, 'ExpectedPublishedSwapToPushSwapOutPreimage']);
        }

        return cbk(null, swap);
      }],

      // Take the funding payment with the preimage
      settle: ['swap', ({swap}, cbk) => {
        // Exit early when the preimage was already pushed for the swap
        if (!!swap.is_settled) {
          return cbk();
        }

        return settleHodlInvoice({lnd, secret: preimage}, cbk);
      }],

      // Mark the swap as settled so that the sweep can be cosigned
      settled: ['settle', 'swap', ({swap}, cbk) => {
        swap.is_settled = true;

        return cbk();
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
