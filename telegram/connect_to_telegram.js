const asyncAuto = require('async/auto');
const asyncForever = require('async/forever');
const asyncMap = require('async/map');
const {getWalletInfo} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const {getLnds} = require('./../lnd');
const startTelegramBot = require('./start_telegram_bot');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const restartDelayMs = 1000 * 5;

/** Connect nodes to Telegram

  {
    fs: {
      getFile: <Get File Contents Function>
      makeDirectory: <Make Directory Function>
      writeFile: <Write File Function>
    }
    [id]: <Authorized User Id Number>
    logger: <Winston Logger Object>
    [nodes]: [<Node Name String>]
    payments: {
      [limit]: <Total Spendable Budget Tokens Limit Number>
    }
    request: <Request Function>
  }

  @returns via cbk or Promise
*/
module.exports = ({fs, id, logger, nodes, payments, request}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!fs) {
          return cbk([400, 'ExpectedFsToConnectToTelegram']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedLoggerToConnectToTelegram']);
        }

        if (!payments) {
          return cbk([400, 'ExpectedPaymentInstructionsToConnectToTelegram']);
        }

        if (!request) {
          return cbk([400, 'ExpectedRequestFunctionToConnectToTelegram']);
        }

        return cbk();
      },

      // Check nodes
      checkNodes: ['validate', async () => {
        const {lnds} = await getLnds({logger, nodes});

        const withName = lnds.map((lnd, i) => ({lnd, node: (nodes || [])[i]}));

        return await asyncMap(withName, async ({lnd, node}) => {
          try {
            return await getWalletInfo({lnd});
          } catch (err) {
            logger.error({node, err: 'failed_to_connect'});
          }

          return;
        });
      }],

      // Start bot
      start: ['checkNodes', ({}, cbk) => {
        let {limit} = payments;

        return asyncForever(cbk => {
          return getLnds({logger, nodes}, (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            const {lnds} = res;

            return startTelegramBot({
              fs,
              id,
              lnds,
              logger,
              request,
              payments: {limit},
            },
            err => {
              logger.error(err || [503, 'TelegramBotFailed']);

              // Reset payment budget
              limit = Number();

              return setTimeout(() => cbk(), restartDelayMs);
            });
          });
        });
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
