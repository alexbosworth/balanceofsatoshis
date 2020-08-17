const {homedir} = require('os');
const {join} = require('path');

const asyncAuto = require('async/auto');
const asyncEach = require('async/each');
const asyncForever = require('async/forever');
const asyncMap = require('async/map');
const {getWalletInfo} = require('ln-service');
const inquirer = require('inquirer');
const {returnResult} = require('asyncjs-util');
const {subscribeToBlocks} = require('goldengate');
const {subscribeToChannels} = require('ln-service');
const {subscribeToInvoices} = require('ln-service');
const {subscribeToTransactions} = require('ln-service');
const Telegraf = require('telegraf');
const Telegram = require('telegraf/telegram')

const backupCommand = require('./backup_command');
const {getTransactionRecord} = require('./../chain');
const handleMempoolCommand = require('./handle_mempool_command');
const interaction = require('./interaction');
const invoiceCommand = require('./invoice_command');
const liquidityCommand = require('./liquidity_command');
const payCommand = require('./pay_command');
const postChainTransaction = require('./post_chain_transaction');
const postClosedMessage = require('./post_closed_message');
const postForwardedPayments = require('./post_forwarded_payments');
const postOpenMessage = require('./post_open_message');
const postSettledInvoice = require('./post_settled_invoice');
const postUpdatedBackups = require('./post_updated_backups');
const sendMessage = require('./send_message');

let bot;
const botKeyFile = 'telegram_bot_api_key';
const delay = 1000 * 60;
const fromName = node => `${node.alias} ${node.public_key.substring(0, 8)}`;
const home = '.bos';
const {isArray} = Array;
const isNumber = n => !isNaN(n);
const maxCommandDelayMs = 1000 * 10;
const msSince = epoch => Date.now() - (epoch * 1e3);
const network = 'btc';
const restartSubscriptionTimeMs = 1000 * 30;

/** Start a Telegram bot

  {
    fs: {
      getFile: <Get File Contents Function>
      makeDirectory: <Make Directory Function>
      writeFile: <Write File Function>
    }
    [id]: <Authorized User Id Number>
    lnds: [<Authenticated LND gRPC API Object>]
    logger: <Winston Logger Object>
    payments: {
      [limit]: <Total Spendable Budget Tokens Limit Number>
    }
    request: <Request Function>
  }

  @returns via cbk or Promise
*/
module.exports = ({fs, id, lnds, logger, payments, request}, cbk) => {
  let connectedId = id;
  let isStopped = false;
  let paymentsLimit = !payments || !payments.limit ? Number() : payments.limit;

  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!fs) {
          return cbk([400, 'ExpectedFileSystemMethodsToStartTelegramBot']);
        }

        if (!isArray(lnds) || !lnds.length) {
          return cbk([400, 'ExpectedLndsToStartTelegramBot']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedLoggerToStartTelegramBot']);
        }

        if (!payments) {
          return cbk([400, 'ExpectedPaymentLimitationsToStartTelegramBot']);
        }

        if (!isNumber(payments.limit)) {
          return cbk([400, 'ExpectedPaymentsLimitTokensNumberToStartBot']);
        }

        if (!request) {
          return cbk([400, 'ExpectedRequestMethodToStartTelegramBot']);
        }

        return cbk();
      },

      // Ask for an API key
      apiKey: ['validate', ({}, cbk) => {
        const path = join(...[homedir(), home, botKeyFile]);

        return fs.getFile(path, (err, res) => {
          if (!!err || !res || !res.toString()) {
            const token = interaction.api_token_prompt;

            inquirer.prompt([token]).then(({key}) => cbk(null, key));

            return;
          }

          return cbk(null, res.toString());
        });
      }],

      // Get node info
      getNodes: ['validate', ({}, cbk) => {
        return asyncMap(lnds, (lnd, cbk) => {
          return getWalletInfo({lnd}, (err, res) => {
            if (!!err) {
              return cbk([503, 'FailedToGetNodeInfo', {err}]);
            }

            return cbk(null, {
              lnd,
              alias: res.alias,
              from: fromName({alias: res.alias, public_key: res.public_key}),
              public_key: res.public_key,
            });
          });
        },
        cbk);
      }],

      // Save API key
      saveKey: ['apiKey', ({apiKey}, cbk) => {
        const path = join(...[homedir(), home, botKeyFile]);

        return fs.makeDirectory(join(...[homedir(), home]), () => {
          // Ignore errors when making directory, it may already be present

          return fs.writeFile(path, apiKey, err => {
            if (!!err) {
              return cbk([503, 'FailedToSaveTelegramApiToken', {err}]);
            }

            return cbk();
          });
        });
      }],

      // Setup the bot start action
      initBot: ['apiKey', 'getNodes', ({apiKey, getNodes}, cbk) => {
        // Exit early when bot is already instantiated
        if (!!bot) {
          return cbk();
        }

        bot = new Telegraf(apiKey);

        const telegram = new Telegram(apiKey)

        telegram.setMyCommands([
          {command: 'backup', description: 'Get node backup file'},
          {command: 'blocknotify', description: 'Get notified on next block'},
          {command: 'connect', description: 'Get connect code for the bot'},
          {command: 'invoice', description: 'Create an invoice'},
          {command: 'liquidity', description: 'Get liquidity [with-peer]'},
          {command: 'mempool', description: 'Get info about the mempool'},
          {command: 'pay', description: 'Pay a payment request'},
        ]);

        bot.catch(err => logger.error({telegram_error: err}));

        bot.use((ctx, next) => {
          // Ignore messages that are old
          if (!!ctx.message && msSince(ctx.message.date) > maxCommandDelayMs) {
            return;
          }

          // Warn on edit of old message
          if (!!ctx.update && !!ctx.update.edited_message) {
            const {text} = ctx.update.edited_message;
            const warning = interaction.edit_message_warning;

            return ctx.replyWithMarkdown(`${warning}\n${text}`);
          }

          return next();
        });

        bot.start(({replyWithMarkdown}) => {
          if (!!connectedId) {
            return replyWithMarkdown(interaction.bot_is_connected);
          }

          return replyWithMarkdown(interaction.start_message);
        });

        bot.command('backup', ({message, reply}) => {
          backupCommand({
            logger,
            reply,
            request,
            from: message.from.id,
            id: connectedId,
            key: apiKey,
            nodes: getNodes,
          },
          err => !!err && !!err[0] >= 500 ? logger.error({err}) : null);

          return;
        });

        bot.command('blocknotify', ({replyWithMarkdown}) => {
          let currentHeight;
          const sub = subscribeToBlocks({delay, network, request});

          sub.on('block', ({height}) => {
            // Exit early when there is no current height
            if (!currentHeight) {
              currentHeight = height;

              return replyWithMarkdown([
                interaction.requesting_block_notification,
                `Chain height is currently ${height}`,
              ].join('. '));
            }

            replyWithMarkdown([
              interaction.block_notification,
              `Chain height is now ${height}`,
            ].join('. '));

            return sub.removeAllListeners();
          });

          sub.on('error', err => logger.error(err));

          return;
        });

        bot.command('connect', ({from, replyWithMarkdown}) => {
          if (!!connectedId) {
            return replyWithMarkdown(interaction.bot_is_connected);
          }

          return replyWithMarkdown(`Connection code is: *${from.id}*`);
        });

        bot.command('invoice', ({message, reply}) => {
          invoiceCommand({
            reply,
            request,
            from: message.from.id,
            id: connectedId,
            key: apiKey,
            nodes: getNodes,
            text: message.text,
          },
          err => !!err && !!err[0] >= 500 ? logger.error({err}) : null);

          return;
        });

        bot.command('mempool', async ({replyWithMarkdown}) => {
          return await handleMempoolCommand({
            request,
            reply: replyWithMarkdown,
          });
        });

        bot.command('liquidity', ({message, reply}) => {
          liquidityCommand({
            reply,
            request,
            from: message.from.id,
            id: connectedId,
            key: apiKey,
            nodes: getNodes,
            text: message.text,
          },
          err => {
            if (!!err) {
              return logger.error(err);
            }

            return;
          });
        });

        bot.command('pay', async ({message, reply}) => {
          const budget = paymentsLimit;

          if (!budget) {
            return reply(interaction.pay_budget_depleted);
          }

          // Stop budget while payment is in flight
          paymentsLimit = 0;

          payCommand({
            budget,
            reply,
            request,
            from: message.from.id,
            id: connectedId,
            key: apiKey,
            nodes: getNodes,
            text: message.text,
          },
          (err, res) => {
            if (!!err) {
              return logger.error({err});
            }

            // Set the payments limit to the amount unspent by the pay command
            paymentsLimit = budget - res.tokens;

            return;
          });

          return;
        });

        bot.help(ctx => {
          const commands = [
            '/backup - Get node backup file',
            '/blocknotify - Notification on next block',
            '/connect - Connect bot',
            '/invoice - Make an invoice',
            '/mempool - BTC mempool report',
            '/pay - Pay an invoice',
          ];

          return ctx.replyWithMarkdown(`🤖\n${commands.join('\n')}`);
        });

        bot.launch();

        return cbk();
      }],

      // Ask the user to confirm their user id
      userId: ['initBot', ({}, cbk) => {
        // Exit early when the id is specified
        if (!!id) {
          return cbk();
        }

        inquirer.prompt([interaction.user_id_prompt]).then(({code}) => {
          if (!code) {
            return cbk([400, 'ExpectedConnectCode']);
          }

          connectedId = code;

          return cbk();
        });

        return;
      }],

      // Subscribe to backups
      backups: ['apiKey', 'getNodes', 'userId', ({apiKey, getNodes}, cbk) => {
        return asyncEach(getNodes, (node, cbk) => {
          return postUpdatedBackups({
            logger,
            request,
            id: connectedId,
            key: apiKey,
            lnd: node.lnd,
            node: {alias: node.alias, public_key: node.public_key},
          },
          cbk);
        },
        cbk);
      }],

      // Channel status changes
      channels: [
        'apiKey',
        'getNodes',
        'userId',
        ({apiKey, getNodes, userId}, cbk) =>
      {
        return asyncEach(getNodes, ({from, lnd}, cbk) => {
          const sub = subscribeToChannels({lnd});

          sub.on('channel_closed', update => {
            return postClosedMessage({
              from,
              lnd,
              request,
              capacity: update.capacity,
              id: connectedId,
              is_breach_close: update.is_breach_close,
              is_cooperative_close: update.is_cooperative_close,
              is_local_force_close: update.is_local_force_close,
              is_remote_force_close: update.is_remote_force_close,
              key: apiKey,
              partner_public_key: update.partner_public_key,
            },
            err => !!err ? logger.error({closed_err: err}) : null);
          });

          sub.on('channel_opened', update => {
            return postOpenMessage({
              from,
              lnd,
              request,
              capacity: update.capacity,
              id: connectedId,
              is_partner_initiated: update.is_partner_initiated,
              is_private: update.is_private,
              key: apiKey,
              partner_public_key: update.partner_public_key,
            },
            err => !!err ? logger.error({open_err: err}) : null);
          });

          sub.once('error', err => {
            // Terminate subscription and restart after a delay
            sub.removeAllListeners();

            return cbk([503, 'UnexpectedErrorInChannelsSubscription', {err}]);
          });

          return;
        },
        cbk);
      }],

      // Send connected message
      connected: [
        'apiKey',
        'getNodes',
        'userId',
        ({apiKey, getNodes}, cbk) =>
      {
        logger.info({is_connected: true});

        return sendMessage({
          request,
          id: connectedId,
          key: apiKey,
          text: `_Connected to ${getNodes.map(({from}) => from).join(', ')}_`,
        },
        cbk);
      }],

      // Poll for forwards
      forwards: ['apiKey', 'getNodes', 'userId', ({apiKey, getNodes}, cbk) => {
        return asyncEach(getNodes, ({from, lnd}, cbk) => {
          return postForwardedPayments({
            from,
            lnd,
            request,
            id: connectedId,
            key: apiKey,
          },
          cbk);
        },
        cbk);
      }],

      // Subscribe to invoices
      invoices: ['apiKey', 'getNodes', 'userId', ({apiKey, getNodes}, cbk) => {
        return asyncEach(getNodes, ({from, lnd}, cbk) => {
          const sub = subscribeToInvoices({lnd});

          sub.on('invoice_updated', invoice => {
            return postSettledInvoice({
              from,
              lnd,
              request,
              id: connectedId,
              invoice: {
                description: invoice.description,
                id: invoice.id,
                is_confirmed: invoice.is_confirmed,
                payments: invoice.payments,
                received: invoice.received,
              },
              key: apiKey,
            },
            err => !!err ? logger.error({settled_err: err}) : null);
          });

          sub.on('error', err => {
            sub.removeAllListeners();

            logger.error({invoices_err: err});

            return cbk([503, 'InvoicesSubscriptionFailed', {err, from}]);
          });
        },
        cbk);
      }],

      // Subscribe to chain transactions
      transactions: [
        'apiKey',
        'getNodes',
        'userId',
        ({apiKey, getNodes}, cbk) =>
      {
        let isFinished = false;

        return asyncEach(getNodes, ({from, lnd}, cbk) => {
          const sub = subscribeToTransactions({lnd});
          const transactions = [];

          sub.on('chain_transaction', async transaction => {
            const {id} = transaction;

            // Exit early when this transaction has already been seen
            if (transactions.includes(id)) {
              return;
            }

            transactions.push(id);

            try {
              const record = await getTransactionRecord({lnd, id});

              if (!record || !record.tx) {
                return;
              }

              return await postChainTransaction({
                from,
                lnd,
                request,
                id: connectedId,
                key: apiKey,
                transaction: record,
              });
            } catch (err) {
              logger.error({chain_tx_err: err});

              if (!!isFinished) {
                return;
              }

              isFinished = true;

              sub.removeAllListeners({});

              return cbk(err);
            }
          });

          sub.on('error', err => {
            sub.removeAllListeners();

            if (!!isFinished) {
              return;
            }

            isFinished = true;

            logger.error({
              chain_subscription_err: err,
              node: from,
            });

            return cbk(err);
          });

          return;
        },
        cbk);
      }],
    },
    (err, res) => {
      isStopped = true;

      return returnResult({reject, resolve})(err, res);
    });
  });
};
