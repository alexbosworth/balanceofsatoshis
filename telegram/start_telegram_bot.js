const {homedir} = require('os');
const {join} = require('path');

const {actOnMessageReply} = require('ln-telegram');
const asyncAuto = require('async/auto');
const asyncEach = require('async/each');
const asyncForever = require('async/forever');
const asyncMap = require('async/map');
const asyncRetry = require('async/retry');
const {Bot} = require('grammy');
const {getForwards} = require('ln-service');
const {getNetwork} = require('ln-service');
const {getTransactionRecord} = require('ln-sync');
const {getWalletInfo} = require('ln-service');
const {handleBackupCommand} = require('ln-telegram');
const {handleBlocknotifyCommand} = require('ln-telegram');
const {handleButtonPush} = require('ln-telegram');
const {handleConnectCommand} = require('ln-telegram');
const {handleCostsCommand} = require('ln-telegram');
const {handleEarningsCommand} = require('ln-telegram');
const {handleEditedMessage} = require('ln-telegram');
const {handleGraphCommand} = require('ln-telegram');
const {handleInvoiceCommand} = require('ln-telegram');
const {handleLiquidityCommand} = require('ln-telegram');
const {handleMempoolCommand} = require('ln-telegram');
const {handlePayCommand} = require('ln-telegram');
const {handlePendingCommand} = require('ln-telegram');
const {handleStartCommand} = require('ln-telegram');
const {handleStopCommand} = require('ln-telegram');
const {handleVersionCommand} = require('ln-telegram');
const {InputFile} = require('grammy');
const inquirer = require('inquirer');
const {isMessageReplyAction} = require('ln-telegram');
const {notifyOfForwards} = require('ln-telegram');
const {postChainTransaction} = require('ln-telegram');
const {postClosedMessage} = require('ln-telegram');
const {postClosingMessage} = require('ln-telegram');
const {postCreatedTrade} = require('ln-telegram');
const {postOpenMessage} = require('ln-telegram');
const {postOpeningMessage} = require('ln-telegram');
const {postSettledInvoice} = require('ln-telegram');
const {postSettledPayment} = require('ln-telegram');
const {postSettledTrade} = require('ln-telegram');
const {postUpdatedBackup} = require('ln-telegram');
const {returnResult} = require('asyncjs-util');
const {sendMessage} = require('ln-telegram');
const {serviceAnchoredTrades} = require('paid-services');
const SocksProxyAgent = require('socks-proxy-agent');
const {subscribeToBackups} = require('ln-service');
const {subscribeToBlocks} = require('goldengate');
const {subscribeToChannels} = require('ln-service');
const {subscribeToInvoices} = require('ln-service');
const {subscribeToPastPayments} = require('ln-service');
const {subscribeToPendingChannels} = require('ln-sync');
const {subscribeToTransactions} = require('ln-service');

const interaction = require('./interaction');
const named = require('./../package').name;
const {version} = require('./../package');

let allNodes;
let bot;
const botKeyFile = 'telegram_bot_api_key';
const delay = 1000 * 60;
const fileAsDoc = file => new InputFile(file.source, file.filename);
const fromName = node => `${node.alias} ${node.public_key.substring(0, 8)}`;
const home = '.bos';
const {isArray} = Array;
const isNumber = n => !isNaN(n);
const limit = 99999;
const markdown = {parse_mode: 'Markdown'};
const maxCommandDelayMs = 1000 * 10;
const msSince = epoch => Date.now() - (epoch * 1e3);
const network = 'btc';
const {parse} = JSON;
const restartSubscriptionTimeMs = 1000 * 30;
const sanitize = n => (n || '').replace(/_/g, '\\_').replace(/[*~`]/g, '');

/** Start a Telegram bot

  {
    fs: {
      getFile: <Get File Contents Function>
      [is_reset_state]: <Reset File Status Bool>
      makeDirectory: <Make Directory Function>
      writeFile: <Write File Function>
    }
    [id]: <Authorized User Id Number>
    limits: {
      min_forward_tokens: <Minimum Forward Tokens To Notify Number>
    }
    lnds: [<Authenticated LND API Object>]
    logger: <Winston Logger Object>
    payments: {
      [limit]: <Total Spendable Budget Tokens Limit Number>
    }
    [proxy]: <Path to Proxy JSON File String>
    request: <Request Function>
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  const {fs, id, limits, lnds, logger, payments, request} = args;

  let connectedId = id;
  let isStopped = false;
  let paymentsLimit = !payments || !payments.limit ? Number() : payments.limit;
  const subscriptions = [];

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
          // Exit early when resetting the API key
          if (!!err || !res || !res.toString() || !!fs.is_reset_state) {
            const token = interaction.api_token_prompt;

            inquirer.prompt([token]).then(({key}) => cbk(null, {key}));

            return;
          }

          return cbk(null, {is_saved: true, key: res.toString()});
        });
      }],

      // Get node info
      getNodes: ['validate', ({}, cbk) => {
        return asyncMap(lnds, (lnd, cbk) => {
          return getWalletInfo({lnd}, (err, res) => {
            if (!!err) {
              return cbk([503, 'FailedToGetNodeInfo', {err}]);
            }

            const named = fromName({
              alias: res.alias,
              public_key: res.public_key,
            });

            return cbk(null, {
              lnd,
              alias: res.alias,
              from: sanitize(named),
              public_key: res.public_key,
            });
          });
        },
        cbk);
      }],

      // Get proxy agent
      getProxyAgent: ['validate', ({}, cbk) => {
        // Exit early if not using a proxy
        if (!args.proxy) {
          return cbk();
        }

        return args.fs.getFile(args.proxy, (err, res) => {
          if (!!err) {
            return cbk([503, 'FailedToFindFileAtProxySpecifiedPath', {err}]);
          }

          if (!res) {
            return cbk([503, 'ExpectedFileDataAtProxySpecifiedPath']);
          }

          try {
            parse(res.toString());
          } catch (err) {
            return cbk([503, 'ExpectedValidJsonConfigFileForProxy']);
          }

          const {host, password, port, userId} = parse(res);

          try {
            const socksAgent = new SocksProxyAgent({
              host,
              password,
              port,
              userId,
            });

            return cbk(null, socksAgent);
          } catch (err) {
            return cbk([503, 'FailedToCreateSocksProxyAgent', {err}]);
          }
        });
      }],

      // Save API key
      saveKey: ['apiKey', ({apiKey}, cbk) => {
        // Exit early when API key is already saved
        if (!!apiKey.is_saved) {
          return cbk();
        }

        const path = join(...[homedir(), home, botKeyFile]);

        return fs.makeDirectory(join(...[homedir(), home]), () => {
          // Ignore errors when making directory, it may already be present

          return fs.writeFile(path, apiKey.key, err => {
            if (!!err) {
              return cbk([503, 'FailedToSaveTelegramApiToken', {err}]);
            }

            return cbk();
          });
        });
      }],

      // Setup the bot start action
      initBot: [
        'apiKey',
        'getNodes',
        'getProxyAgent',
        ({apiKey, getNodes, getProxyAgent}, cbk) =>
      {
        allNodes = getNodes;

        // Exit early when bot is already instantiated
        if (!!bot) {
          return cbk();
        }

        // Initiate bot using proxy agent when configured
        if (!!getProxyAgent) {
          bot = new Bot(apiKey.key, {
            client: {baseFetchConfig: {agent: getProxyAgent, compress: true}},
          });
        } else {
          bot = new Bot(apiKey.key);
        }

        bot.api.setMyCommands([
          {command: 'backup', description: 'Get node backup file'},
          {command: 'blocknotify', description: 'Get notified on next block'},
          {command: 'connect', description: 'Get connect code for the bot'},
          {command: 'costs', description: 'Show costs over the week'},
          {command: 'earnings', description: 'Show earnings over the week'},
          {command: 'graph', description: 'Show info about a node'},
          {command: 'help', description: 'Show the list of commands'},
          {command: 'invoice', description: 'Create an invoice'},
          {command: 'liquidity', description: 'Get liquidity [with-peer]'},
          {command: 'mempool', description: 'Get info about the mempool'},
          {command: 'pay', description: 'Pay a payment request'},
          {command: 'pending', description: 'Get pending forwards, channels'},
          {command: 'stop', description: 'Stop the bot'},
          {command: 'version', description: 'View current bot version'},
        ]);

        bot.catch(err => logger.error({telegram_error: err}));

        bot.use(async (ctx, next) => {
          try {
            await handleEditedMessage({ctx});
          } catch (err) {
            logger.error({err});
          }

          return next();
        });

        bot.command('backup', ctx => {
          handleBackupCommand({
            logger,
            from: ctx.message.from.id,
            id: connectedId,
            key: apiKey.key,
            nodes: allNodes,
            reply: ctx.reply,
            send: (file, opts) => ctx.replyWithDocument(fileAsDoc(file), opts),
          },
          err => !!err && !!err[0] >= 500 ? logger.error({err}) : null);

          return;
        });

        bot.command('blocknotify', ctx => {
          handleBlocknotifyCommand({
            request,
            reply: n => ctx.reply(n, markdown),
          },
          err => {
            if (!!err) {
              return logger.error({err});
            }

            return;
          });

          return;
        });

        bot.command('connect', ctx => {
          handleConnectCommand({
            from: ctx.from.id,
            id: connectedId,
            reply: n => ctx.reply(n, markdown),
          });

          return;
        });

        bot.command('costs', ctx => {
          handleCostsCommand({
            request,
            from: ctx.message.from.id,
            id: connectedId,
            nodes: allNodes,
            reply: n => ctx.reply(n, markdown),
            working: () => ctx.replyWithChatAction('typing'),
          },
          err => !!err && !!err[0] >= 500 ? logger.error({err}) : null);

          return;
        });

        bot.command('earnings', ctx => {
          handleEarningsCommand({
            from: ctx.message.from.id,
            id: connectedId,
            nodes: allNodes,
            reply: n => ctx.reply(n, markdown),
            working: () => ctx.replyWithChatAction('typing'),
          },
          err => !!err && !!err[0] >= 500 ? logger.error({err}) : null);

          return;
        });

        bot.command('graph', async ctx => {
          try {
            await handleGraphCommand({
              from: ctx.message.from.id,
              id: connectedId,
              nodes: allNodes,
              remove: () => ctx.deleteMessage(),
              reply: (message, options) => ctx.reply(message, options),
              text: ctx.message.text,
              working: () => ctx.replyWithChatAction('typing'),
            });
          } catch (err) {
            logger.error({err});
          }
        });

        // Handle creation of an invoice
        bot.command('invoice', async ctx => {
          try {
            await handleInvoiceCommand({
              ctx,
              id: connectedId,
              nodes: getNodes,
            });
          } catch (err) {
            logger.error({err});
          }
        });

        bot.command('mempool', async ctx => {
          return await handleMempoolCommand({
            request,
            reply: n => ctx.reply(n, markdown),
          });
        });

        bot.command('liquidity', async ctx => {
          try {
            await asyncRetry({
              errorFilter: err => {
                if (err && /^404/.test(err.message)) {
                  return false;
                }

                return true;
              },
            }, async () => {
              await handleLiquidityCommand({
                from: ctx.message.from.id,
                id: connectedId,
                nodes: allNodes,
                reply: n => ctx.reply(n, markdown),
                text: ctx.message.text,
                working: () => ctx.replyWithChatAction('typing'),
              });
            });
          } catch (err) {
            logger.error(err);
          }
        });

        bot.command('pay', async ctx => {
          const budget = paymentsLimit;

          if (!budget) {
            ctx.reply(interaction.pay_budget_depleted);

            return;
          }

          // Stop budget while payment is in flight
          paymentsLimit = 0;

          handlePayCommand({
            budget,
            request,
            from: ctx.message.from.id,
            id: connectedId,
            key: apiKey.key,
            nodes: allNodes,
            reply: ctx.reply,
            text: ctx.message.text,
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

        bot.command('pending', async ctx => {
          try {
            await handlePendingCommand({
              from: ctx.message.from.id,
              id: connectedId,
              nodes: allNodes,
              reply: n => ctx.reply(n),
              working: () => ctx.replyWithChatAction('typing'),
            });
          } catch (err) {
            logger.error({err});
          }
        });

        bot.command('start', ctx => {
          handleStartCommand({
            id: connectedId,
            reply: n => ctx.reply(n, markdown),
          });
        });

        // Terminate the running bot
        bot.command('stop', async ctx => {
          try {
            await handleStopCommand({
              from: ctx.message.from.id,
              id: connectedId,
              quit: () => bot.stop(),
              reply: (msg, mode) => ctx.reply(msg, mode),
            });

            process.exit();
          } catch (err) {
            logger.error({err});
          }
        });

        bot.command('version', async ctx => {
          try {
            await handleVersionCommand({
              named,
              request,
              version,
              reply: n => ctx.reply(n, markdown),
            });
          } catch (err) {
            logger.error({err});
          }
        });

        const commands = [
          '/backup - Get node backup file',
          '/blocknotify - Notification on next block',
          '/connect - Connect bot',
          '/costs - View costs over the past week',
          '/earnings - View earnings over the past week',
          '/graph [pubkey or peer alias] - Show info about a node',
          '/invoice [amount] [memo] - Make an invoice',
          '/liquidity [with] - View node liquidity',
          '/mempool - BTC mempool report',
          '/pay - Pay an invoice',
          '/pending - View pending channels, probes, and forwards',
          '/stop - Stop bot',
          '/version - View the current bot version',
        ];

        bot.command('help', async ctx => {
          try {
            await ctx.reply(`🤖\n${commands.join('\n')}`);
          } catch (err) {
            logger.error({err});
          }
        });

        // Handle button push type commands
        bot.on('callback_query:data', async ctx => {
          try {
            await handleButtonPush({ctx, id: connectedId, nodes: getNodes});
          } catch (err) {
            logger.error({err});
          }
        });

        // Listen for replies to created invoice messages
        bot.on('message').filter(
          ctx => isMessageReplyAction({ctx, nodes: getNodes}),
          async ctx => {
            try {
              return await actOnMessageReply({
                ctx,
                api: bot.api,
                id: connectedId,
                nodes: getNodes,
              });
            } catch (err) {
              logger.error({err});
            }
          },
        );

        bot.start();

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
            return cbk([400, 'ExpectedNumericConnectCode']);
          }

          connectedId = code;

          return cbk();
        });

        return;
      }],

      // Subscribe to backups
      backups: ['apiKey', 'getNodes', 'userId', ({apiKey, getNodes}, cbk) => {
        return asyncEach(getNodes, (node, cbk) => {
          let postBackupTimeoutHandle;
          const sub = subscribeToBackups({lnd: node.lnd});

          subscriptions.push(sub);

          sub.on('backup', ({backup}) => {
            // Cancel pending backup notification when there is a new backup
            if (!!postBackupTimeoutHandle) {
              clearTimeout(postBackupTimeoutHandle);
            }

            // Time delay backup posting to avoid posting duplicate messages
            postBackupTimeoutHandle = setTimeout(() => {
              return postUpdatedBackup({
                backup,
                id: connectedId,
                key: apiKey.key,
                node: {alias: node.alias, public_key: node.public_key},
                send: (id, file) => bot.api.sendDocument(id, fileAsDoc(file)),
              },
              err => !!err ? logger.error({post_backup_err: err}) : null);
            },
            restartSubscriptionTimeMs);

            return;
          });

          sub.once('error', err => {
            // Terminate subscription and restart after a delay
            sub.removeAllListeners();

            return cbk([503, 'ErrorInBackupsSub', {err}]);
          });
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

          subscriptions.push(sub);

          sub.on('channel_closed', update => {
            return postClosedMessage({
              from,
              lnd,
              capacity: update.capacity,
              id: connectedId,
              is_breach_close: update.is_breach_close,
              is_cooperative_close: update.is_cooperative_close,
              is_local_force_close: update.is_local_force_close,
              is_remote_force_close: update.is_remote_force_close,
              partner_public_key: update.partner_public_key,
              send: (id, msg, opt) => bot.api.sendMessage(id, msg, opt),
            },
            err => !!err ? logger.error({node: from, closed_err: err}) : null);
          });

          sub.on('channel_opened', update => {
            return postOpenMessage({
              from,
              lnd,
              capacity: update.capacity,
              id: connectedId,
              is_partner_initiated: update.is_partner_initiated,
              is_private: update.is_private,
              partner_public_key: update.partner_public_key,
              send: (id, msg, opt) => bot.api.sendMessage(id, msg, opt),
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

      // Pending channels changes
      pending: ['apiKey', 'getNodes', 'userId', ({getNodes, userId}, cbk) => {
        return asyncEach(getNodes, ({from, lnd}, cbk) => {
          const sub = subscribeToPendingChannels({lnd});

          subscriptions.push(sub);

          sub.on('closing', update => {
            return postClosingMessage({
              from,
              lnd,
              closing: update.channels,
              id: connectedId,
              send: (id, msg, opt) => bot.api.sendMessage(id, msg, opt),
            },
            err => !!err ? logger.error({node: from, closing_err: err}) : null);
          });

          sub.on('opening', update => {
            return postOpeningMessage({
              from,
              lnd,
              id: connectedId,
              opening: update.channels,
              send: (id, msg, opt) => bot.api.sendMessage(id, msg, opt),
            },
            err => !!err ? logger.error({node: from, pend_err: err}) : null);
          });

          sub.once('error', err => {
            // Terminate subscription and restart after a delay
            sub.removeAllListeners();

            return cbk([503, 'UnexpectedErrorInPendingSubscription', {err}]);
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
          key: apiKey.key,
          text: `_Connected to ${getNodes.map(({from}) => from).join(', ')}_`,
        },
        cbk);
      }],

      // Poll for forwards
      forwards: ['apiKey', 'getNodes', 'userId', ({apiKey, getNodes}, cbk) => {
        return asyncEach(getNodes, (node, cbk) => {
          let after = new Date().toISOString();
          const {from} = node;
          const {lnd} = node;

          return asyncForever(cbk => {
            if (isStopped) {
              return cbk([503, 'ExpectedNonStoppedBotToReportForwards']);
            }

            const before = new Date().toISOString();

            return getForwards({after, before, limit, lnd}, (err, res) => {
              // Exit early and ignore errors
              if (!!err) {
                return setTimeout(cbk, restartSubscriptionTimeMs);
              }

              // Push cursor forward
              after = before;

              // Notify Telegram bot that forwards happened
              return notifyOfForwards({
                from,
                lnd,
                request,
                forwards: res.forwards.filter(forward => {
                  if (!limits || !limits.min_forward_tokens) {
                    return true;
                  }

                  return forward.tokens >= limits.min_forward_tokens;
                }),
                id: connectedId,
                key: apiKey.key,
                node: node.public_key,
              },
              err => {
                if (!!err) {
                  logger.error({forwards_notify_err: err});
                }

                return setTimeout(cbk, restartSubscriptionTimeMs);
              });
            });
          },
          cbk);
        },
        cbk);
      }],

      // Subscribe to invoices
      invoices: ['apiKey', 'getNodes', 'userId', ({apiKey, getNodes}, cbk) => {
        return asyncEach(getNodes, (node, cbk) => {
          const sub = subscribeToInvoices({lnd: node.lnd});

          subscriptions.push(sub);

          sub.on('invoice_updated', invoice => {
            return postSettledInvoice({
              from: node.from,
              id: connectedId,
              invoice: {
                description: invoice.description,
                id: invoice.id,
                is_confirmed: invoice.is_confirmed,
                payments: invoice.payments,
                received: invoice.received,
              },
              key: node.public_key,
              lnd: node.lnd,
              nodes: getNodes,
              quiz: ({answers, correct, question}) => {
                return bot.api.sendQuiz(
                  connectedId,
                  question,
                  answers,
                  {correct_option_id: correct},
                );
              },
              send: (id, msg, opts) => bot.api.sendMessage(id, msg, opts),
            },
            err => !!err ? logger.error({settled_err: err}) : null);
          });

          sub.on('error', err => {
            sub.removeAllListeners();

            logger.error({invoices_err: err});

            sendMessage({
              request,
              id: connectedId,
              key: apiKey.key,
              text: `_😵 Lost connection to nodes! Cannot connect to ${from}._`,
            },
            () => {
              return cbk([503, 'InvoicesSubscriptionFailed', {err, from}]);
            });
          });
        },
        cbk);
      }],

      // Subscribe to past payments
      payments: ['apiKey', 'getNodes', 'userId', ({apiKey, getNodes}, cbk) => {
        return asyncEach(getNodes, (node, cbk) => {
          const sub = subscribeToPastPayments({lnd: node.lnd});

          subscriptions.push(sub);

          sub.on('payment', payment => {
            // Ignore rebalances
            if (payment.destination === node.public_key) {
              return;
            }

            return postSettledPayment({
              request,
              from: node.from,
              id: connectedId,
              key: apiKey.key,
              lnd: node.lnd,
              nodes: getNodes.map(n => n.public_key),
              payment: {
                destination: payment.destination,
                id: payment.id,
                safe_fee: payment.safe_fee,
                safe_tokens: payment.safe_tokens,
              },
            },
            err => !!err ? logger.error({post_payment_error: err}) : null);

            return;
          });

          sub.on('error', err => {
            // Terminate subscription and restart after a delay
            sub.removeAllListeners();

            return cbk([503, 'ErrorInPaymentsSub', {err}])
          });
        },
        cbk);
      }],

      // Service trade secrets
      secrets: ['apiKey', 'getNodes', 'userId', ({apiKey, getNodes}, cbk) => {
        return asyncEach(getNodes, (node, cbk) => {
          const sub = serviceAnchoredTrades({lnd: node.lnd});
          const start = new Date().toISOString();

          subscriptions.push(sub);

          sub.on('settled', async trade => {
            try {
              await postSettledTrade({
                api: bot.api,
                description: trade.description,
                destination: node.public_key,
                lnd: node.lnd,
                nodes: getNodes,
                to: trade.to,
                tokens: trade.tokens,
                user: connectedId,
              });
            } catch (err) {
              logger.error({err});
            }
          });

          sub.on('start', async trade => {
            // Exit early when this is an older trade
            if (trade.created_at < start) {
              return;
            }

            try {
              await postCreatedTrade({
                api: bot.api,
                description: trade.description,
                destination: node.public_key,
                expires_at: trade.expires_at,
                id: trade.id,
                lnd: node.lnd,
                nodes: getNodes,
                tokens: trade.tokens,
                user: connectedId,
              });
            } catch (err) {
              logger.error({err});
            }
          });

          sub.on('error', err => {
            sub.removeAllListeners();

            logger.error({err});

            return cbk(err);
          });

          return;
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

          subscriptions.push(sub);

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
                confirmed: transaction.is_confirmed,
                id: connectedId,
                send: (id, message) => bot.api.sendMessage(id, message, markdown),
                transaction: record,
              });
            } catch (err) {
              logger.error({chain_tx_err: err, node: from});

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

      subscriptions.forEach(n => n.removeAllListeners());

      return returnResult({reject, resolve}, cbk)(err, res);
    });
  });
};
