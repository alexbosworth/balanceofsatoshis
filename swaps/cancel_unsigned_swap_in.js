const asyncAuto = require('async/auto');
const asyncReflect = require('async/reflect');
const {cancelHodlInvoice} = require('ln-service');
const {cancelSwapIn} = require('goldengate');
const {returnResult} = require('asyncjs-util');

const isHash = n => !!n && /^[0-9A-F]{64}$/i.test(n);

/** Cancel a swap in that is not signed yet, along with its swap invoice

  {
    id: <Swap Hash Hex String>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    metadata: <Authentication Metadata Object>
    service: <Swap Service Object>
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isHash(args.id)) {
          return cbk([400, 'ExpectedSwapHashToCancelUnsignedSwapIn']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToCancelUnsignedSwapIn']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToCancelUnsignedSwapIn']);
        }

        if (!args.metadata) {
          return cbk([400, 'ExpectedAuthMetadataToCancelUnsignedSwapIn']);
        }

        if (!args.service) {
          return cbk([400, 'ExpectedServiceToCancelUnsignedSwapIn']);
        }

        return cbk();
      },

      // Cancel the swap with the service, releasing its deposits
      cancelSwap: ['validate', asyncReflect(({}, cbk) => {
        return cancelSwapIn({
          id: args.id,
          metadata: args.metadata,
          service: args.service,
        },
        cbk);
      })],

      // Cancel the swap invoice so that it can no longer be paid
      cancelInvoice: ['cancelSwap', asyncReflect(({}, cbk) => {
        return cancelHodlInvoice({id: args.id, lnd: args.lnd}, cbk);
      })],

      // Report the cancel of the swap
      reportSwap: ['cancelSwap', ({cancelSwap}, cbk) => {
        // Exit early when the swap could not be canceled
        if (!!cancelSwap.error) {
          args.logger.error({failed_to_cancel_swap_in: cancelSwap.error});

          return cbk();
        }

        args.logger.info({canceled_swap_in: args.id});

        return cbk();
      }],

      // Report a failure to cancel the swap invoice
      reportInvoice: ['cancelInvoice', ({cancelInvoice}, cbk) => {
        // Exit early when the swap invoice was canceled
        if (!cancelInvoice.error) {
          return cbk();
        }

        args.logger.error({
          failed_to_cancel_swap_in_invoice: cancelInvoice.error,
        });

        return cbk();
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
