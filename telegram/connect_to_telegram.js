const asyncAuto = require('async/auto');
const asyncForever = require('async/forever');
const asyncMap = require('async/map');
const {getWalletInfo} = require('ln-service');
const {postNodesOffline} = require('ln-telegram');
const {returnResult} = require('asyncjs-util');

const {getLnds} = require('./../lnd');
const getTelegramBot = require('./get_telegram_bot');
const runTelegramBot = require('./run_telegram_bot');

const defaultPaymentsBudget = 0;
const isNumber = n => !isNaN(n);
const restartDelayMs = 1000 * 60 * 3;
const smallUnitsType = 'full';

/** Connect nodes to Telegram

  {
    fs: {
      getFile: <Get File Contents Function>
      getFileStatus: <Get File Status Function>
      makeDirectory: <Make Directory Function>
      writeFile: <Write File Function>
    }
    [id]: <Authorized User Id Number>
    is_small_units: <Formatting Should Use Small Units Bool>
    logger: <Winston Logger Object>
    [min_forward_tokens]: <Minimum Forward Tokens Number>
    [nodes]: [<Node Name String>]
    payments: {
      [limit]: <Total Spendable Budget Tokens Limit Number>
    }
    [proxy]: <Path to Proxy JSON File String>
    request: <Request Function>
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!Object.fromEntries) {
          return cbk([400, 'ExpectedLaterVersionOfNodeJsInstalled']);
        }

        if (!args.fs) {
          return cbk([400, 'ExpectedFsToConnectToTelegram']);
        }

        if (!!args.id && !isNumber(args.id)) {
          return cbk([400, 'ExpectedNumericConnectCodeToConnectToTelegram']);
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

      // Get the nodes
      getNodes: ['validate', async () => {
        const {nodes} = args;

        const {lnds} = await getLnds({nodes, logger: args.logger});

        const withName = lnds.map((lnd, i) => ({lnd, node: (nodes || [])[i]}));

        return asyncMap(withName, async ({lnd, node}) => {
          try {
            const wallet = await getWalletInfo({lnd});

            return {node, alias: wallet.alias, id: wallet.public_key};
          } catch (err) {
            args.logger.error({node, err: 'failed_to_connect'});

            throw err;
          }
        });
      }],

      // Get the telegram bot
      getBot: ['validate', ({}, cbk) => {
        return getTelegramBot({fs: args.fs, proxy: args.proxy}, cbk);
      }],

      // Set the units formatting
      setUnits: ['validate', ({}, cbk) => {
        // Exit early when using default units formatting
        if (!args.is_small_units) {
          return cbk();
        }

        process.env.PREFERRED_TOKENS_TYPE = smallUnitsType;

        return cbk();
      }],

      // Start bot
      start: ['getBot', 'getNodes', 'setUnits', ({getBot, getNodes}, cbk) => {
        let {limit} = args.payments;
        let online = getNodes.map(n => n.id);

        return asyncForever(cbk => {
          return runTelegramBot({
            bot: getBot.bot,
            fs: args.fs,
            id: Number(args.id),
            key: getBot.key,
            min_forward_tokens: args.min_forward_tokens,
            logger: args.logger,
            nodes: args.nodes,
            payments_limit: limit || defaultPaymentsBudget,
            request: args.request,
          },
          (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            const offline = online.filter(id => !res.online.includes(id));

            // Refresh the current online status
            online = res.online.slice();

            // Reset payment budget
            limit = Number();

            return postNodesOffline({
              bot: getBot.bot,
              connected: res.connected,
              offline: getNodes.filter(n => offline.includes(n.id)),
            },
            err => {
              if (!!err) {
                args.logger.error({post_nodes_offline_error: err});
              }

              return setTimeout(cbk, restartDelayMs);
            });
          });
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
