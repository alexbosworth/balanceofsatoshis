const asyncAuto = require('async/auto');
const asyncForever = require('async/forever');
const {getForwards} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const notifyOfForwards = require('./notify_of_forwards');
const sendMessage = require('./send_message');

const limit = 99999;
const pollingIntervalMs = 1000 * 30;

/** Poll for forwarded payments and post them as they come in

  {
    from: <Node From String>
    id: <Connected User Id Number>
    key: <Telegram API Key String>
    lnd: <Authenticated LND gRPC API Object>
    request: <Request Function>
  }

  @returns via cbk or Promise
*/
module.exports = ({from, id, key, lnd, request}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!from) {
          return cbk([400, 'ExpectedFromToPostForwardedPayments']);
        }

        if (!id) {
          return cbk([400, 'ExpectedConnectedIdToPostForwardedPayments']);
        }

        if (!key) {
          return cbk([400, 'ExpectedTelegramIdToPostForwardedPayments']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndToPostForwardedPayments']);
        }

        if (!request) {
          return cbk([400, 'ExpectedRequestFunctionToPostForwardedPayments']);
        }

        return cbk();
      },

      // Post forwarded payments
      postForwards: ['validate', ({}, cbk) => {
        let after = new Date().toISOString();

        return asyncForever(cbk => {
          const before = new Date().toISOString();

          return getForwards({after, before, limit, lnd}, (err, res) => {
            // Exit early and ignore errors
            if (!!err) {
              return setTimeout(cbk, pollingIntervalMs);
            }

            // Push cursor forward
            after = before;

            // Notify Telegram bot that forwards happened
            return notifyOfForwards({
              from,
              id,
              key,
              lnd,
              request,
              forwards: res.forwards,
            },
            () => setTimeout(cbk, pollingIntervalMs));
          });
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
