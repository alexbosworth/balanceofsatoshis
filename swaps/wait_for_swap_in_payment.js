const asyncAuto = require('async/auto');
const {cancelHodlInvoice} = require('ln-service');
const {deferSwapInCoopSettlement} = require('goldengate');
const {getInvoice} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {subscribeToBlocks} = require('ln-service');
const {subscribeToInvoice} = require('ln-service');

const depositsNote = 'Swap in again with --recovery or refund after expiry';
const isHash = n => !!n && /^[0-9A-F]{64}$/i.test(n);
const {isInteger} = Number;
const msPerSecond = 1000;
const msUntil = epochMs => Math.max(epochMs - Date.now(), Number());

/** Wait for the swap service to pay for a swap in

  {
    id: <Swap Hash Hex String>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    metadata: <Authentication Metadata Object>
    notifications: {
      accepted: [{
        at: <Notification Received At Epoch Milliseconds Number>
        id: <Swap Hash Hex String>
      }]
      rejected: [<Swap Hash Hex String>]
      sweeps: [{
        id: <Swap Hash Hex String>
        psbt: <Settlement Transaction PSBT Hex String>
      }]
    }
    payment_timeout_seconds: <Service Payment Deadline Seconds Number>
    service: <Swap Service Object>
    timeout: <Swap HTLC Timeout Height Number>
    updates: <Notifications Updated EventEmitter Object>
  }

  @returns via cbk or Promise
  {
    deferred: [<Deferred Settlement Request Object>]
    received: <Received Tokens Number>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isHash(args.id)) {
          return cbk([400, 'ExpectedSwapHashToWaitForSwapInPayment']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToWaitForSwapInPayment']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToWaitForSwapInPayment']);
        }

        if (!args.metadata) {
          return cbk([400, 'ExpectedAuthMetadataToWaitForSwapInPayment']);
        }

        if (!args.notifications) {
          return cbk([400, 'ExpectedNotificationsToWaitForSwapInPayment']);
        }

        if (!isInteger(args.payment_timeout_seconds)) {
          return cbk([400, 'ExpectedPaymentTimeoutToWaitForSwapInPayment']);
        }

        if (!args.service) {
          return cbk([400, 'ExpectedServiceToWaitForSwapInPayment']);
        }

        if (!isInteger(args.timeout)) {
          return cbk([400, 'ExpectedHtlcTimeoutToWaitForSwapInPayment']);
        }

        if (!args.updates) {
          return cbk([400, 'ExpectedUpdatesToWaitForSwapInPayment']);
        }

        return cbk();
      },

      // Wait for the payment, or give up when the swap will not be paid
      wait: ['validate', ({}, cbk) => {
        const blocks = subscribeToBlocks({lnd: args.lnd});
        const invoice = subscribeToInvoice({id: args.id, lnd: args.lnd});
        const timeoutMs = args.payment_timeout_seconds * msPerSecond;
        const waiting = {deferred: []};

        const finished = (err, res) => {
          // Exit early when waiting already finished
          if (!!waiting.is_finished) {
            return;
          }

          waiting.is_finished = true;

          clearTimeout(waiting.deadline);

          args.updates.removeListener('update', waiting.check);
          blocks.removeAllListeners();
          invoice.removeAllListeners();

          return cbk(err, {...res, deferred: waiting.deferred});
        };

        const giveUp = failure => finished(null, {failure});

        // Defer a settlement request that comes before the payment
        const defer = sweep => {
          waiting.deferred.push(sweep);

          return deferSwapInCoopSettlement({
            id: args.id,
            metadata: args.metadata,
            psbt: sweep.psbt,
            service: args.service,
          },
          err => {
            // Exit early when the service was told the swap is not finished
            if (!err) {
              return;
            }

            return args.logger.error({swap_in_sweep_deferral_error: err});
          });
        };

        // Look at the swap service notifications about the swap
        waiting.check = () => {
          // Exit early when the service will not pay for the swap
          if (args.notifications.rejected.includes(args.id)) {
            return giveUp([503, 'SwapServiceRejectedSwapInDeposits']);
          }

          const early = args.notifications.sweeps.filter(sweep => {
            return sweep.id === args.id && !waiting.deferred.includes(sweep);
          });

          // The service asks again for a deferred settlement once it is paid
          early.forEach(sweep => defer(sweep));

          const {accepted} = args.notifications;

          const acceptance = accepted.find(n => n.id === args.id);

          // Exit early when the payment deadline did not start or is running
          if (!acceptance || !!waiting.deadline) {
            return;
          }

          // The service has to pay by its deadline, which may have passed
          const remainingMs = msUntil(acceptance.at + timeoutMs);

          waiting.deadline = setTimeout(() => {
            return giveUp([503, 'SwapInPaymentDeadlinePassed']);
          },
          remainingMs);

          return;
        };

        blocks.on('block', ({height}) => {
          // Exit early when the swap HTLC has not timed out yet
          if (height < args.timeout) {
            return;
          }

          return giveUp([503, 'SwapInHtlcTimedOutWithoutPayment']);
        });

        blocks.on('error', err => {
          return finished([503, 'UnexpectedBlocksErrorForSwapIn', {err}]);
        });

        invoice.on('error', err => finished(err));

        invoice.on('invoice_updated', updated => {
          // Exit early when the swap is not paid yet
          if (!updated.is_confirmed) {
            return;
          }

          return finished(null, {received: updated.received});
        });

        args.updates.on('update', waiting.check);

        return waiting.check();
      }],

      // Cancel the invoice of a swap that was not paid so it cannot be paid
      cancel: ['wait', ({wait}, cbk) => {
        // Exit early when the swap was paid
        if (!wait.failure) {
          return cbk();
        }

        return cancelHodlInvoice({id: args.id, lnd: args.lnd}, err => {
          return cbk(null, {err});
        });
      }],

      // Check if a swap invoice that could not be canceled was paid
      checkPaid: ['cancel', 'wait', ({cancel, wait}, cbk) => {
        // Exit early when the swap was paid or the invoice was canceled
        if (!wait.failure || !cancel.err) {
          return cbk();
        }

        return getInvoice({id: args.id, lnd: args.lnd}, cbk);
      }],

      // The payment received for the swap
      payment: [
        'cancel',
        'checkPaid',
        'wait',
        ({cancel, checkPaid, wait}, cbk) =>
      {
        const {deferred} = wait;

        // Exit early when the swap was paid while waiting
        if (!wait.failure) {
          return cbk(null, {deferred, received: wait.received});
        }

        // Exit early when the swap was paid while giving up on it
        if (!!checkPaid && !!checkPaid.is_confirmed) {
          return cbk(null, {deferred, received: checkPaid.received});
        }

        const [code, message] = wait.failure;

        // Exit early when the invoice is canceled, it can no longer be paid
        if (!cancel.err) {
          return cbk([code, message, {deposits: depositsNote}]);
        }

        return cbk([503, 'FailedToCancelUnpaidSwapInInvoice', {
          err: cancel.err,
          failure: message,
        }]);
      }],
    },
    returnResult({reject, resolve, of: 'payment'}, cbk));
  });
};
