const {homedir} = require('os');
const {join} = require('path');

const asyncAuto = require('async/auto');
const asyncForever = require('async/forever');
const asyncMap = require('async/map');
const {getWalletInfo} = require('ln-service');
const {lmdbDatabase} = require('ln-sync');
const {returnResult} = require('asyncjs-util');

const {getLnds} = require('./../lnd');
const startTelegramBot = require('./start_telegram_bot');
const watch = require('./watch');

const home = '.bos';
const restartDelayMs = 1000 * 60 * 3;

/** Connect nodes to Telegram

  {
    fs: {
      getFile: <Get File Contents Function>
      getFileStatus: <Get File Status Function>
      makeDirectory: <Make Directory Function>
      writeFile: <Write File Function>
    }
    [id]: <Authorized User Id Number>
    [is_sync_disabled]: <Database Sync Disabled Bool>
    logger: <Winston Logger Object>
    [nodes]: [<Node Name String>]
    payments: {
      [limit]: <Total Spendable Budget Tokens Limit Number>
    }
    request: <Request Function>
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.fs) {
          return cbk([400, 'ExpectedFsToConnectToTelegram']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToConnectToTelegram']);
        }

        if (!args.payments) {
          return cbk([400, 'ExpectedPaymentInstructionsToConnectToTelegram']);
        }

        if (!args.request) {
          return cbk([400, 'ExpectedRequestFunctionToConnectToTelegram']);
        }

        return cbk();
      },

      // Check nodes
      checkNodes: ['validate', async () => {
        const {nodes} = args;

        const {lnds} = await getLnds({nodes, logger: args.logger});

        const withName = lnds.map((lnd, i) => ({lnd, node: (nodes || [])[i]}));

        return await asyncMap(withName, async ({lnd, node}) => {
          try {
            return await getWalletInfo({lnd});
          } catch (err) {
            args.logger.error({node, err: 'failed_to_connect'});
          }

          return;
        });
      }],

      // Home directory path
      path: ['checkNodes', ({}, cbk) => {
        return cbk(null, join(...[homedir(), home]));
      }],

      // Start bot
      startTelegram: ['checkNodes', ({}, cbk) => {
        let {limit} = args.payments;

        return asyncForever(cbk => {
          return getLnds({
            logger: args.logger,
            nodes: args.nodes
          },
          (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            const {lnds} = res;

            args.logger.info({connecting_to_telegram: args.nodes});

            return startTelegramBot({
              lnds,
              fs: args.fs,
              id: args.id,
              logger: args.logger,
              payments: {limit},
              request: args.request,
            },
            err => {
              args.logger.error(err || [503, 'TelegramBotFailed']);

              // Reset payment budget
              limit = Number();

              return setTimeout(() => cbk(), restartDelayMs);
            });
          });
        },
        cbk);
      }],

      // Init database
      lmdbDb: ['path', ({path}, cbk) => {
        // Exit early when there is no need for a database
        if (!!args.is_sync_disabled) {
          return cbk();
        }

        return lmdbDatabase({path, fs: args.fs}, cbk);
      }],

      // Start syncing nodes with the database
      startSync: ['lmdbDb', ({lmdbDb}, cbk) => {
        // Exit early when there is no database
        if (!lmdbDb) {
          return cbk();
        }

        return asyncForever(cbk => {
          return watch({
            db: lmdbDb.db,
            logger: args.logger,
            nodes: args.nodes,
          },
          err => {
            if (!!err) {
              args.logger.error(err);

              return setTimeout(() => cbk(), restartDelayMs);
            }

            args.logger.error({restarting_sync: true});

            return setTimeout(() => cbk(), restartDelayMs);
          });
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
