const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');
const {subscribeToPastPayment} = require('ln-service');

const isHash = n => !!n && /^[0-9A-F]{64}$/i.test(n);
const notFound = 404;

/** Get the pending paths of an in-flight payment

  {
    id: <Payment Hash Hex String>
    lnd: <Authenticated LND API Object>
    timeout_ms: <Give Up Waiting For Payment Details After Milliseconds Number>
  }

  @returns via cbk or Promise
  {
    [created_at]: <Payment Created At ISO 8601 Date String>
    id: <Payment Hash Hex String>
    paths: [{
      fee: <Total Fee Tokens Pending Number>
      hops: [{
        channel: <Standard Format Channel Id String>
        forward: <Forward Tokens Number>
        public_key: <Public Key Hex String>
      }]
      timeout: <Expiration Block Height Number>
      tokens: <Total Tokens Pending Number>
    }]
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isHash(args.id)) {
          return cbk([400, 'ExpectedPaymentHashToGetPendingPaths']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToGetPendingPaths']);
        }

        if (!args.timeout_ms) {
          return cbk([400, 'ExpectedTimeoutMillisecondsToGetPendingPaths']);
        }

        return cbk();
      },

      // Subscribe to the payment to get its current state
      getPaths: ['validate', ({}, cbk) => {
        const sub = subscribeToPastPayment({id: args.id, lnd: args.lnd});

        // Removing the listeners cancels the subscription to the payment
        const finished = (err, res) => {
          clearTimeout(timeout);

          sub.removeAllListeners();

          return cbk(err, res);
        };

        // Payments that are not in flight have no pending paths
        const noPaths = () => finished(null, {id: args.id, paths: []});

        const timeout = setTimeout(noPaths, args.timeout_ms);

        sub.once('confirmed', noPaths);
        sub.once('end', noPaths);
        sub.once('failed', noPaths);

        sub.once('error', err => {
          // Exit early when the payment is not a known payment
          if (err[0] === notFound) {
            return noPaths();
          }

          return finished(err);
        });

        sub.once('paying', pending => {
          return finished(null, {
            created_at: pending.created_at,
            id: args.id,
            paths: pending.paths,
          });
        });

        return;
      }],
    },
    returnResult({reject, resolve, of: 'getPaths'}, cbk));
  });
};
