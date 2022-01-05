const {homedir} = require('os');
const {join} = require('path');

const asyncAuto = require('async/auto');
const asyncEach = require('async/each');
const asyncForever = require('async/forever');
const asyncMap = require('async/map');
const asyncRetry = require('async/retry');
const {Bot} = require('grammy');
const {getForwards} = require('ln-service');
const {getTransactionRecord} = require('ln-sync');
const {getWalletInfo} = require('ln-service');
const {handleBackupCommand} = require('ln-telegram');
const {handleBlocknotifyCommand} = require('ln-telegram');
const {handleConnectCommand} = require('ln-telegram');
const {handleCostsCommand} = require('ln-telegram');
const {handleEarningsCommand} = require('ln-telegram');
const {handleInvoiceCommand} = require('ln-telegram');
const {handleLiquidityCommand} = require('ln-telegram');
const {handleMempoolCommand} = require('ln-telegram');
const {handlePayCommand} = require('ln-telegram');
const {handlePendingCommand} = require('ln-telegram');
const {handleVersionCommand} = require('ln-telegram');
const {InputFile} = require('grammy');
const {InlineKeyboard} = require('grammy');
const inquirer = require('inquirer');
const {Menu} = require("@grammyjs/menu");
const {notifyOfForwards} = require('ln-telegram');
const {postChainTransaction} = require('ln-telegram');
const {postClosedMessage} = require('ln-telegram');
const {postOpenMessage} = require('ln-telegram');
const {postSettledInvoice} = require('ln-telegram');
const {postSettledPayment} = require('ln-telegram');
const {postUpdatedBackup} = require('ln-telegram');
const {returnResult} = require('asyncjs-util');
const {Router} = require("@grammyjs/router");
const {sendMessage} = require('ln-telegram');
const {session} = require('grammy');
const {parsePaymentRequest} = require('ln-service');
const {subscribeToBackups} = require('ln-service');
const {subscribeToBlocks} = require('goldengate');
const {subscribeToChannels} = require('ln-service');
const {subscribeToInvoices} = require('ln-service');
const {subscribeToPastPayments} = require('ln-service');
const {subscribeToTransactions} = require('ln-service');

const interaction = require('./interaction');
const markdown = {parse_mode: 'Markdown'};
const handleTradeRoute = require('./handle_trade_route');
const named = require('./../package').name;
const paidServices = require('../../paid-services');
const requestTradeById = require('paid-services/trades/request_trade_by_id');
const {version} = require('./../package');
const {getIdentity} = require('ln-service');

let allNodes;
let bot;
let savedNode;
const botKeyFile = 'telegram_bot_api_key';
const delay = 1000 * 60;
const fileAsDoc = file => new InputFile(file.source, file.filename);
const fromName = node => `${node.alias} ${node.public_key.substring(0, 8)}`;
const home = '.bos';
const {isArray} = Array;
const isNumber = n => !isNaN(n);
const limit = 99999;
const maxCommandDelayMs = 1000 * 10;
const msSince = epoch => Date.now() - (epoch * 1e3);
const network = 'btc';
const restartSubscriptionTimeMs = 1000 * 30;
const sanitize = n => (n || '').replace(/_/g, '\\_').replace(/[*~`]/g, '');
const asNumber = n => parseFloat(n, 10);

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
    request: <Request Function>
  }

  @returns via cbk or Promise
*/
module.exports = ({fs, id, limits, lnds, logger, payments, request}, cbk) => {
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
      initBot: ['apiKey', 'getNodes', ({apiKey, getNodes}, cbk) => {
        allNodes = getNodes;

        // Exit early when bot is already instantiated
        if (!!bot) {
          return cbk();
        }

        bot = new Bot(apiKey.key);

        //initialise sssion, router and menu
        bot.use(session({ initial: () => ({ step: 'idle' }) }));
        const router = new Router((ctx) => ctx.session.step);
        const inlineKeyboard = new InlineKeyboard();
        const selectSavedNode = new InlineKeyboard();
        const selectPubkey = new InlineKeyboard();
        const tradeList = new InlineKeyboard();


        bot.api.setMyCommands([
          {command: 'backup', description: 'Get node backup file'},
          {command: 'blocknotify', description: 'Get notified on next block'},
          {command: 'connect', description: 'Get connect code for the bot'},
          {command: 'costs', description: 'Show costs over the week'},
          {command: 'earnings', description: 'Show earnings over the week'},
          {command: 'help', description: 'Show the list of commands'},
          {command: 'invoice', description: 'Create an invoice'},
          {command: 'liquidity', description: 'Get liquidity [with-peer]'},
          {command: 'mempool', description: 'Get info about the mempool'},
          {command: 'pay', description: 'Pay a payment request'},
          {command: 'pending', description: 'Get pending forwards, channels'},
          {command: 'trade', description: 'Create or decode a trade'},
          {command: 'version', description: 'View current bot version'},
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

            return ctx.reply(`${warning}\n${text}`, markdown);
          }

          return next();
        });

        bot.command('backup', ctx => {
          handleBackupCommand({
            logger,
            request,
            from: ctx.message.from.id,
            id: connectedId,
            key: apiKey.key,
            nodes: allNodes,
            reply: ctx.reply,
            send: file => ctx.replyWithDocument(fileAsDoc(file)),
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

        bot.command('invoice', ({message, reply}) => {
          handleInvoiceCommand({
            reply,
            request,
            from: message.from.id,
            id: connectedId,
            key: apiKey.key,
            nodes: allNodes,
            text: message.text,
          },
          err => !!err && !!err[0] >= 500 ? logger.error({err}) : null);

          return;
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
                request,
                from: ctx.message.from.id,
                id: connectedId,
                key: apiKey.key,
                nodes: allNodes,
                reply: ctx.reply,
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
            });
          } catch (err) {
            logger.error({err});
          }
        });
        
        bot.command('start', ctx => {
          // Exit early when the bot is already connected
          if (!!connectedId) {
            return ctx.reply(interaction.bot_is_connected, markdown);
          }
          
          return ctx.reply(interaction.start_message, markdown);
        });


        //Build the trade keyboard
        inlineKeyboard.text('Create Trade', 'create-trade');
        inlineKeyboard.text('Purchase Trade', 'purchase-trade');
        inlineKeyboard.text('Decode Trade', 'decode-trade');

        //Build the open/close trade handler keyboard
        selectPubkey.text('Yes', 'create-closed-trade');
        selectPubkey.text('No', 'create-open-trade');
        
        //inline keyboard for selecting saved node
        if(allNodes.length > 1) {
          for (let i=0; i< allNodes.length; i++) {
            selectSavedNode.text(allNodes[i].alias, allNodes[i].alias);
          }
        }
        else {
          savedNode = allNodes[0];
        }

        //Trade command will ask for saved node first if multiple are available
        bot.command('trade', async ctx => {
          try {
            if(allNodes.length > 1) {
            await ctx.reply('Select your saved node', {reply_markup: selectSavedNode});
            }
            else {
            await ctx.reply('What would you like to do?', {reply_markup: inlineKeyboard});
            }
              await ctx.deleteMessage();
            } catch(err){
              logger.error({err})
            }
          });                  

          //when creating new trade ask for open or closed trade by asking if user wants to enter a pubkey
          bot.callbackQuery('create-trade', async ctx => {
            try {
              await ctx.reply('Do you want to enter a pubkey?', {reply_markup: selectPubkey});
            } catch (err) {
              logger.error({err});
            }
          });

        //Create closed trade keyboard click
        bot.callbackQuery('create-closed-trade', async ctx => {
          try{
            await ctx.deleteMessage();
            await handleTradeRoute({
              lnd: savedNode,
              trade: 'create-closed-trade',
              ctx,
              router,
              markdown,
              logger,
            });
          } catch (err) {
            logger.error({err});
          }
        });

        //Create open trade keyboard click
        bot.callbackQuery('create-open-trade', async ctx => {
          try{
            await ctx.deleteMessage();
            await handleTradeRoute({
              lnd: savedNode,
              trade: 'create-open-trade',
              ctx,
              router,
              markdown,
              logger,
            });
          } catch (err) {
            logger.error({err});
          }
        });

        //purchase trade keyboard click
        bot.callbackQuery('purchase-trade', async ctx => {
          try{
            await ctx.deleteMessage();
            await handleTradeRoute({
              lnd: savedNode,
              trade: 'purchase',
              ctx,
              router,
              markdown,
              logger,
            });
          } catch (err) {
            logger.error({err});
          }
        });

        //decode a trade keyboard click
        bot.callbackQuery('decode-trade', async ctx => {
          try{
            await ctx.deleteMessage();
            await handleTradeRoute({
              lnd: savedNode,
              trade: 'decrypt',
              ctx,
              router,
              markdown,
              logger,
            });
          } catch (err) {
            logger.error({err});
          }
        });

        //listen for saved node clicks and pass saved node to handle trades
        bot.on('callback_query:data', async(ctx) => {
          await ctx.deleteMessage();
          const clickedButton = ctx.callbackQuery.data;
          if(allNodes.length > 1) {
            for(let i=0; i < allNodes.length; i++) {
              if(allNodes[i].alias === clickedButton) {
                savedNode = allNodes[i];
                await ctx.reply('What would you like to do?', {reply_markup: inlineKeyboard});
              }
            }
          }
          //get the session variable from handle_trade_route to and get trade/payment details and listen to keyboard clicks
          if(!!ctx.session.openTrades) {
            try{
              const requestedTrade = await requestTradeById({
                id: clickedButton,
                lnd: savedNode.lnd,
                to: ctx.session.openTrades.to,
              });
              const parseInvoice = await parsePaymentRequest({request: requestedTrade.request});
              const decryptDetails = {
                auth: requestedTrade.auth,
                payload: requestedTrade.payload,
                from: parseInvoice.destination,
              }
              //store details needed for opentrade decryption in a session variable
              ctx.session.decryptDetails = decryptDetails;
              ctx.session.openTrades = undefined;

              await ctx.reply(`Description:\n${parseInvoice.description}\n\n${requestedTrade.request}\n\nPrice: ${parseInvoice.tokens} sats`);

            } catch (err) {
              await ctx.reply('Unable to get trade from peer', markdown);
              logger.error({err});
            }
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
          '/invoice - Make an invoice',
          '/liquidity [with] - View node liquidity',
          '/mempool - BTC mempool report',
          '/pay - Pay an invoice',
          '/pending - View pending channels, probes, and forwards',
          '/trade - Create or decode a trade',
          '/version - View the current bot version',
        ];

        bot.command('help', async ctx => {
          try {
            await ctx.reply(`🤖\n${commands.join('\n')}`);
          } catch (err) {
            logger.error({err});
          }
        });

        bot.use(router);
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
              request,
              capacity: update.capacity,
              id: connectedId,
              is_breach_close: update.is_breach_close,
              is_cooperative_close: update.is_cooperative_close,
              is_local_force_close: update.is_local_force_close,
              is_remote_force_close: update.is_remote_force_close,
              key: apiKey.key,
              partner_public_key: update.partner_public_key,
            },
            err => !!err ? logger.error({node: from, closed_err: err}) : null);
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
              key: apiKey.key,
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
        return asyncEach(getNodes, ({from, lnd}, cbk) => {
          const sub = subscribeToInvoices({lnd});

          subscriptions.push(sub);

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
              key: apiKey.key,
              quiz: ({answers, correct, question}) => {
                return bot.api.sendQuiz(
                  connectedId,
                  question,
                  answers,
                  {correct_option_id: correct},
                );
              },
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
                request,
                confirmed: transaction.is_confirmed,
                id: connectedId,
                key: apiKey.key,
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
