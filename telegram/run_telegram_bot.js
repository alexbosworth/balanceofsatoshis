const asyncAuto = require('async/auto');
const asyncFilter = require('async/filter');
const asyncMap = require('async/map');
const {authenticatedLndGrpc} = require('ln-service');
const {getIdentity} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const {getLnds} = require('./../lnd');
const {lndCredentials} = require('./../lnd');
const startTelegramBot = require('./start_telegram_bot');
const currentDate = new Date();
const defaultError = [503, 'TelegramBotStopped'];
const expiryDuration = 1000 * 60 * 60 * 24 * 180;
const macaroonExpiryDate = new Date(currentDate.getTime() + expiryDuration).toISOString();
const {isArray} = Array;

/** Run the telegram bot for a node or multiple nodes

  {
    bot: <Telegram Bot Object>
    fs: {
      getFile: <Get File Contents Function>
      [is_reset_state]: <Reset File Status Bool>
      makeDirectory: <Make Directory Function>
      writeFile: <Write File Function>
    }
    [id]: <Authorized User Id Number>
    key: <Telegram Bot API Key String>
    [min_forward_tokens]: <Minimum Forward Tokens To Notify Number>
    logger: <Winston Logger Object>
    nodes: [<Node Name String>]
    payments_limit: <Total Spendable Budget Tokens Limit Number>
    [proxy]: <Socks Proxy Agent Object>
    request: <Request Function>
  }

  @returns via cbk or Promise
  {
    [connected]: <Connected Id Number>
    online: [{
      alias: <Node Alias String>
      id: <Node Public Key Id Hex String>
    }]
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.bot) {
          return cbk([400, 'ExpectedTelegramBotToRunTelegramBot']);
        }

        if (!args.fs) {
          return cbk([400, 'ExpectedFilesystemMethodsToRunTelegramBot']);
        }

        if (!args.key) {
          return cbk([400, 'ExpectedApiKeyToRunTelegramBot']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedWinstonLoggerToRunTelegramBot']);
        }

        if (!isArray(args.nodes)) {
          return cbk([400, 'ExpectedArrayOfSavedNodesToRunTelegramBot']);
        }

        if (args.payments_limit === undefined) {
          return cbk([400, 'ExpectedPaymentsLimitToRunTelegramBot']);
        }

        if (!args.request) {
          return cbk([400, 'ExpectedRequestFunctionToRunTelegrambot']);
        }

        return cbk();
      },

      // Get associated LNDs
      getLnds: ['validate', async ({}) => {
        //Use default macaroon if budget is set
        if (!!args.payments_limit) {
          return await getLnds({logger: args.logger, nodes: args.nodes});
        }

        const nodes = args.nodes;

        //if no saved node is specified, use the default node
        if (!nodes || !nodes.length) {
          try {
            const credentials =  await lndCredentials({
              expiry: macaroonExpiryDate,
              logger: args.logger,
              is_nospend: true,
              node: args.node,
            });
  
            const {lnd} = await authenticatedLndGrpc({
              cert: credentials.cert,
              macaroon: credentials.macaroon,
              socket: credentials.socket,
            });

            return {lnds: [lnd]};

            //Ignore errors if unable to generate LND credentials
          } catch (err) {
          return await getLnds({logger: args.logger, nodes: args.nodes});
          }
        }

        //if saved node(s) is specified, use the saved node(s)
        try {
          const lnds = await asyncMap(nodes, async (node) => {
            const credentials =  await lndCredentials({
              expiry: macaroonExpiryDate,
              logger: args.logger,
              is_nospend: true,
              node,
            });
            
            const {lnd} = await authenticatedLndGrpc({
              cert: credentials.cert,
              macaroon: credentials.macaroon,
              socket: credentials.socket,
            });

            return lnd;
          });

          return {lnds};

          //Ignore errors if unable to generate LND credentials
        } catch (err) {
          return await getLnds({logger: args.logger, nodes: args.nodes});
        }

      }],

      // Start the bot going
      startBot: ['getLnds', ({getLnds}, cbk) => {
        args.logger.info({connecting_to_telegram: args.nodes});

        return startTelegramBot({
          bot: args.bot,
          fs: args.fs,
          id: args.id,
          key: args.key,
          min_forward_tokens: args.min_forward_tokens,
          lnds: getLnds.lnds,
          logger: args.logger,
          payments_limit: args.payments_limit,
          proxy: args.proxy,
          request: args.request,
        },
        cbk);
      }],

      // Check the LNDs that they can connect
      getConnected: ['getLnds', 'startBot', ({getLnds}, cbk) => {
        return asyncMap(getLnds.lnds, (lnd, cbk) => {
          return getIdentity({lnd}, (err, res) => {
            // Return no id when there is an error getting the wallet info
            if (!!err) {
              return cbk();
            }

            return cbk(null, res.public_key);
          });
        },
        cbk);
      }],

      // Final set of connected nodes
      online: ['getConnected', 'startBot', ({getConnected, startBot}, cbk) => {
        // Report the failure that killed the bot
        if (!!startBot.failure) {
          args.logger.error({err: startBot.failure});
        }

        const online = getConnected.filter(n => !!n);

        return cbk(null, {
          connected: startBot.connected,
          online: getConnected.filter(n => !!n),
        });
      }],
    },
    returnResult({reject, resolve, of: 'online'}, cbk));
  });
};
