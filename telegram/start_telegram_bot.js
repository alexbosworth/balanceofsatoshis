const asyncAuto = require('async/auto');
const asyncEach = require('async/each');
const asyncForever = require('async/forever');
const asyncMap = require('async/map');
const {getForwards} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const inquirer = require('inquirer');
const {returnResult} = require('asyncjs-util');
const {subscribeToInvoices} = require('ln-service');
const Telegraf = require('telegraf');

const sendMessage = require('./send_message');

const {isArray} = Array;
const limit = 99999;
const pollingIntervalMs = 30 * 1000;
const startMessage = 'Bot started, run /connect to authorize';

/** Start a Telegram bot

  {
    [id]: <Authorized User Id Number>
    lnds: [<Authenticated LND gRPC API Object>]
    logger: <Winston Logger Object>
    request: <Request Function>
  }

  @returns via cbk or Promise
*/
module.exports = ({id, lnds, logger, request}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isArray(lnds) || !lnds.length) {
          return cbk([400, 'ExpectedLndsToStartTelegramBot']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedLoggerToStartTelegramBot']);
        }

        if (!request) {
          return cbk([400, 'ExpectedRequestMethodToStartTelegramBot']);
        }

        return cbk();
      },

      // Ask for an API key
      apiKey: ['validate', ({}, cbk) => {
        const token = {
          message: 'Enter Telegram bot API key ',
          name: 'key',
          type: 'password',
        };

        inquirer.prompt([token]).then(({key}) => cbk(null, key));

        return;
      }],

      // Get node info
      getInfo: ['validate', ({}, cbk) => {
        return asyncMap(lnds, (lnd, cbk) => {
          return getWalletInfo({lnd}, (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            return cbk(null, {
              lnd,
              alias: res.alias,
              from: `${res.alias} ${res.public_key.substring(0, 8)}`,
              public_key: res.public_key,
            });
          });
        },
        cbk);
      }],

      // Setup the bot start action
      initBot: ['apiKey', ({apiKey}, cbk) => {
        const bot = new Telegraf(apiKey);

        bot.start(({reply}) => reply(startMessage));

        bot.command('connect', ctx => {
          return ctx.reply(`'Connection code is: ${ctx.from.id}`);
        });

        bot.help((ctx) => ctx.reply('Activate with /connect'));

        bot.launch();

        return cbk();
      }],

      // Ask the user to confirm their user id
      userId: ['initBot', ({}, cbk) => {
        if (!!id) {
          return cbk(null, id);
        }

        const userId = {
          message: 'Connection code? (Bot command: /connect)',
          name: 'code',
          type: 'number',
        };

        inquirer.prompt([userId]).then(({code}) => cbk(null, code));

        return;
      }],

      // Send connected message
      connected: [
        'apiKey',
        'getInfo',
        'userId',
        ({apiKey, getInfo, userId}, cbk) =>
      {
        logger.info({is_connected: true});

        return sendMessage({
          request,
          id: userId,
          key: apiKey,
          text: `_Connected to ${getInfo.map(({from}) => from).join(', ')}_`,
        },
        cbk);
      }],

      // Poll for forwards
      forwards: [
        'apiKey',
        'getInfo',
        'userId',
        ({apiKey, getInfo, userId}, cbk) =>
      {
        return asyncEach(getInfo, (node, cbk) => {
          let after = new Date().toISOString();
          const {lnd} = node;

          return asyncForever(cbk => {
            const before = new Date().toISOString();

            return getForwards({after, before, limit, lnd}, (err, res) => {
              if (!!err) {
                return cbk(err);
              }

              // Push cursor forward
              after = before;

              // Exit early when there are no forwards
              if (!res.forwards.length) {
                return setTimeout(cbk, pollingIntervalMs);
              }

              const forwards = res.forwards.map(forward => {
                return `- Earned ${forward.fee} forwarding ${forward.tokens}`;
              });

              return sendMessage({
                request,
                id: userId,
                key: apiKey,
                text: `*${node.from}*\n${forwards.join('\n')}`,
              },
              err => {
                if (!!err) {
                  return cbk(err);
                }

                return setTimeout(cbk, pollingIntervalMs);
              });
            });
          },
          cbk);
        },
        cbk);
      }],

      // Subscribe to invoices
      invoices: [
        'apiKey',
        'getInfo',
        'userId',
        ({apiKey, getInfo, userId}, cbk) =>
      {
        return getInfo.forEach(node => {
          const sub = subscribeToInvoices({lnd: node.lnd});

          sub.on('invoice_updated', async invoice => {
            if (!invoice.is_confirmed) {
              return;
            }

            const {description} = invoice;
            const {received} = invoice;

            try {
              const {from} = node;

              await sendMessage({
                request,
                id: userId,
                key: apiKey,
                text: `*${from}*\n- Received ${received} for “${description}”`,
              });
            } catch (err) {
              logger.error(err);
            }

            return;
          });

          sub.on('error', err => logger.error(err));

          return;
        });
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
