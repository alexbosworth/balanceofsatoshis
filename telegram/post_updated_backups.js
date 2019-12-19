const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');
const {subscribeToBackups} = require('ln-service');

const sendFile = require('./send_file');

const date = () => new Date().toISOString().substring(0, 10);
const pollingIntervalMs = 1000 * 60;

/** Post updated backups to Telegram

  {
    id: <Connected User Id Number>
    key: <Telegram API Key String>
    lnd: <Authenticated LND gRPC API Object>
    logger: <Winston Logger Object>
    node: {
      alias: <Node Alias String>
      public_key: <Public Key Hex String>
    }
    request: <Request Function>
  }

  @returns via cbk or Promise
*/
module.exports = ({id, key, lnd, logger, node, request}, cbk) => {
  new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!id) {
          return cbk([400, 'ExpectedIdToPostUpdatedBackups']);
        }

        if (!key) {
          return cbk([400, 'ExpectedApiKeyToPostUpdatedBackups']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndToPostUpdatedBackups']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedLoggerToPostUpdatedBackups']);
        }

        if (!node) {
          return cbk([400, 'ExpectedNodeToPostUpdatedBackups']);
        }

        if (!request) {
          return cbk([400, 'ExpectedRequestFunctionToPostUpdatedBackups']);
        }

        return cbk();
      },

      // Subscribe to backups
      subscribe: ['validate', ({}, cbk) => {
        let postBackup;
        const sub = subscribeToBackups({lnd});

        sub.on('backup', ({backup}) => {
          const filename = `${date()}-${node.alias}-${node.public_key}.backup`;
          const hex = backup;

          // Cancel pending backup notification when there is a new backup
          if (!!postBackup) {
            clearTimeout(postBackup);
          }

          // Time delay backup posting to avoid posting duplicate messages
          postBackup = setTimeout(async () => {
            try {
              await sendFile({filename, hex, id, key, request});
            } catch (err) {
              logger.error({err});
            }
          },
          pollingIntervalMs);

          return;
        });

        sub.on('error', err => cbk(null, err));

        return;
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
