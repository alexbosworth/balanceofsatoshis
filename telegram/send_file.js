const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const api = 'https://api.telegram.org';
const contentType = 'application/binary';
const ok = 200;

/** Send a file to Telegram

  {
    filename: <File Name String>
    hex: <Hex Data String>
    id: <Chat Id String>
    key: <API Key String>
    request: <Request Method Function>
  }
*/
module.exports = ({filename, hex, id, key, request}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!filename) {
          return cbk([400, 'ExpectedFileNameToSendToTelegram']);
        }

        if (!hex) {
          return cbk([400, 'ExpectedHexDataToSendToTelegram']);
        }

        if (!id) {
          return cbk([400, 'ExpectedChatIdToSendMessageToTelegram']);
        }

        if (!key) {
          return cbk([400, 'ExpectedApiKeyToSendMessageToTelegram']);
        }

        if (!request) {
          return cbk([400, 'ExpectedRequestFunctionToSendMessageToTelegram']);
        }

        return cbk();
      },

      // Send document
      send: ['validate', ({}, cbk) => {
        return request({
          formData: {
            document: {
              value: Buffer.from(hex, 'hex'),
              options: {contentType, filename},
            },
          },
          method: 'POST',
          qs: {chat_id: id},
          url: `${api}/bot${key}/sendDocument`,
        },
        (err, r, body) => {
          if (!!err) {
            return cbk([503, 'FailedToConnectToTelegramApiToSendDocument']);
          }

          if (!r) {
            return cbk([503, 'ExpectedResponseFromTelegramSendDocument']);
          }

          if (r.statusCode !== ok) {
            console.log("BODY", body);
            return cbk([503, 'UnexpectedStatusCodeSendingDocumentToTelegram']);
          }

          return cbk();
        });
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
