const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const api = 'https://api.telegram.org';
const ok = 200;
const parseMode = 'markdown';

/** Send message to Telegram

  {
    id: <Chat Id String>
    key: <API Key String>
    request: <Request Method Function>
    text: <Message Text String>
  }
*/
module.exports = ({id, key, request, text}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!id) {
          return cbk([400, 'ExpectedChatIdToSendMessageToTelegram']);
        }

        if (!key) {
          return cbk([400, 'ExpectedApiKeyToSendMessageToTelegram']);
        }

        if (!request) {
          return cbk([400, 'ExpectedRequestFunctionToSendMessageToTelegram']);
        }

        if (!text) {
          return cbk([400, 'ExpectedTextOfMessageToSendToTelegram']);
        }

        return cbk();
      },

      // Send Message
      send: ['validate', ({}, cbk) => {
        return request({
          url: `${api}/bot${key}/sendMessage`,
          qs: {text, chat_id: id, parse_mode: parseMode},
        },
        (err, r, body) => {
          if (!!err) {
            return cbk([503, 'FailedToConnectToTelegramApiToSendMessage']);
          }

          if (!r) {
            return cbk([503, 'ExpectedResponseFromTelegramSendMessage']);
          }

          if (r.statusCode !== ok) {
            return cbk([503, 'UnexpectedStatusCodeSendingMessageToTelegram']);
          }

          return cbk();
        });
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
