const asyncAuto = require('async/auto');
const asyncEach = require('async/each');
const {getBackups} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const checkAccess = require('./check_access');
const sendFile = require('./send_file');

const date = () => new Date().toISOString().substring(0, 10);
const {isArray} = Array;

/** Execute backup command

  {
    from: <Command From User Id Number>
    id: <Connected User Id Number>
    key: <Telegram API Key String>
    nodes: [{
      alias: <Node Alias String>
      lnd: <Authenticated LND gRPC API Object>
      public_key: <Node Public Key Hex String>
    }]
    reply: <Reply Function>
    request: <Request Function>
  }

  @returns via cbk or Promise
*/
module.exports = ({from, id, key, logger, nodes, reply, request}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!from) {
          return cbk([400, 'ExpectedFromUserIdToExecuteBackupCommand']);
        }

        if (!id) {
          return cbk([400, 'ExpectedConnectedUserIdToExecuteBackupCommand']);
        }

        if (!key) {
          return cbk([400, 'ExpectedTelegramApiKeyToExecuteBackupCommand']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedLoggerToExecuteBackupCommand']);
        }

        if (!isArray(nodes)) {
          return cbk([400, 'ExpectedNodesArrayToExecuteBackupCommand']);
        }

        if (!reply) {
          return cbk([400, 'ExpectedReplyFunctionToExecuteBackupCommand']);
        }

        if (!request) {
          return cbk([400, 'ExpectedRequestFunctionToExecuteBackupCommand']);
        }

        return cbk();
      },

      // Check access
      checkAccess: ['validate', ({}, cbk) => {
        return checkAccess({from, id, reply}, cbk);
      }],

      // Get backups
      getBackups: ['checkAccess', ({}, cbk) => {
        return asyncEach(nodes, (node, cbk) => {
          return getBackups({lnd: node.lnd}, (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            sendFile({
              id,
              key,
              request,
              filename: `${date()}-${node.alias}-${node.public_key}.backup`,
              hex: res.backup,
            },
            err => !!err ? logger.error({err}) : null);

            return cbk();
          });
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
