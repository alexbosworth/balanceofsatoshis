const asyncAuto = require('async/auto');
const asyncForever = require('async/forever');
const {getForwards} = require('ln-service');
const {returnResult} = require('asyncjs-util');

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

            // Exit early when there are no forwards
            if (!res.forwards.length) {
              return setTimeout(cbk, pollingIntervalMs);
            }

            const forwards = res.forwards.map(({fee, tokens}) => {
              return `- Earned ${fee} forwarding ${tokens}`;
            });

            const text = `💰 *${from}*\n${forwards.join('\n')}`;

            return sendMessage({id, key, request, text}, err => {
              if (!!err) {
                return cbk(err);
              }

              return setTimeout(cbk, pollingIntervalMs);
            });
          });
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
