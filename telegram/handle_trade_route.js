const asyncAuto = require('async/auto');
const {getChannels} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {parsePaymentRequest} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {getNodeAlias} = require('ln-sync');

const {returnResult} = require('asyncjs-util');
const decodeTrade = require('paid-services/trades/decode_trade');
const decryptTradeSecret = require('paid-services/trades/decrypt_trade_secret');
const encodeOpenTrade = require('paid-services/trades/encode_open_trade');
const finalizeTradeSecret = require('paid-services/trades/finalize_trade_secret');
const findTrade = require('./find_trade');
const serviceTradeRequests = require('paid-services/trades/service_trade_requests');
const asNumber = n => parseFloat(n, 10);
const {floor} = Math;
const isNumber = n => !isNaN(n);
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const maxDescriptionLength = 100;
const maxSecretLength = 100;
const nodeName = (alias, id) => `${alias} ${id}`;
const uriAsSocket = n => n.substring(67);
const utf8AsHex = utf8 => Buffer.from(utf8).toString('hex');
const hexAsUtf8 = hex => Buffer.from(hex, 'hex').toString();


module.exports = ({lnd, trade, ctx, router, markdown, logger, keyboard}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!ctx) {
          return cbk([400, 'ExpectedAuthenticatedLndToCreateTrade']);
        }

        if(!trade) {
          return cbk([400, 'ExpectedTradeType']);
        }

        if(!ctx) {
          return cbk([400, 'ExpectedCtxFromTelegram']);
        }

        if(!router) {
          return cbk([400, 'ExpectedRouterFromTelegram']);
        }

        if(!markdown) {
          return cbk([400, 'ExpectedMarkdownFromTelegram']);
        }

        if(!logger) {
          return cbk([400, 'ExpectedLogger']);
        }

        return cbk();
      },

      // Get the node identity key
      getIdentity: ['validate', ({}, cbk) => getWalletInfo({lnd: lnd.lnd}, cbk)],

      // Get the network name to use for an open trade
      getNetwork: ['validate', ({}, cbk) => {
        // Exit early for a closed trade
        if (trade !== 'create-open-trade') {
          return cbk();
        }

        return getNetwork({lnd: lnd.lnd}, cbk);
      }],

      // Get the public channels to use for an open trade
      getChannels: ['validate', ({}, cbk) => {
        // Exit early for a closed trade
        if (trade !== 'create-open-trade') {
          return cbk();
        }
        return getChannels({lnd: lnd.lnd, is_public: true}, cbk);
      }],

      //decode an open or closed trade
      handlePurchaseTradeRoute: [
      'validate',
      'getIdentity',
      'getNetwork',
      'getChannels',
      async ({getIdentity}) => {

        //exit early if not purchasing a trade
        if(trade !== 'purchase') {
          return;
        }

        await ctx.reply('Enter the trade to decode for invoice', markdown);
        ctx.session.step = 'decode-invoice';

        //enter the trade to purchase
        router.route('decode-invoice', async (ctx) => {
          try{
            const askForTrade = ctx.msg.text;
            const details = decodeTrade({trade: askForTrade});
  
            //contact peer to find open trade if it is a closed trade and store trade information in session variable to listen for keyboard clicks in start_telegram_bot
            if(!details.secret) {
              const openTrades = await purchaseOpenTrade(details);
              ctx.session.openTrades = openTrades;
              ctx.session.step = 'idle';
              return;
            }
            const decodedPaymentRequest = parsePaymentRequest({request: details.secret.request});
  
            //notify if the invoice has expired
            if(!!decodedPaymentRequest.is_expired) {
              await ctx.reply('Trade invoice has expired, request a new trade');
              return;
            }
  
            await ctx.reply(`Trade Description: ${decodedPaymentRequest.description}\nTrade Price: ${decodedPaymentRequest.tokens} sat(s)`);
            await ctx.reply(`Invoice to pay is: \n ${details.secret.request}`, markdown);
            ctx.session.step = 'idle';
  
            //find the opentrade details
            async function purchaseOpenTrade(details) {
              await ctx.reply('Contating peer to get trade...', markdown);
              const openTrades = await findTrade({
                lnd: lnd.lnd,
                logger,
                id: details.connect.id,
                identity: getIdentity.public_key,
                nodes: details.connect.nodes,
              });

              //build the keyboard to pick trades
              for(let i=0; i< openTrades.requestTrades.trades.length; i++) {
                keyboard.text(openTrades.requestTrades.trades[i].description, openTrades.requestTrades.trades[i].id).row();
              }
              await ctx.reply(`Trades available for sale are:`, {reply_markup: keyboard});
              return openTrades;
            }
          } catch(err) {
              await ctx.reply('Error deocoding trade or contacting peer timed out', markdown);
              logger.error({err});
            }
        });
        
        //chat replies trade complete if user enters an input after the trade completes
        router.route('idle', async (ctx) => {
          await ctx.reply('Decoding invoice complete, start over with /trade command');
        });
        
      }],


      //decrypt a closed trade after payment
      handleDecryptRoute: [
      'validate',
      async ({}) => {
        //exit early if it's not a decryption
        if(trade !== 'decrypt') {
          return;
        }
        //check for the session variable from start telegram file
        if(!!ctx.session.decryptDetails.auth && !!ctx.session.decryptDetails.payload && !!ctx.session.decryptDetails.from) {
          await ctx.reply('Enter the preimage?', markdown);
          ctx.session.step = 'decrypt-opentrade';
        }
        //if no session variables then treat it as closed trade
        else {
          await ctx.reply('Enter the trade again?', markdown);
          ctx.session.step = 'decode';
        }
  
        //decode the closed trade again for decrypting
        router.route('decode', async (ctx) => {
          try{
            const askForTrade = ctx.msg.text;
            const decodeDetails = decodeTrade({trade: askForTrade});
            const decodedPaymentRequest = parsePaymentRequest({request: decodeDetails.secret.request});

            ctx.session.decodeDetails = decodeDetails;
            ctx.session.decodedPaymentRequest = decodedPaymentRequest;
            await ctx.reply('Enter the preimage?', markdown);
            ctx.session.step = 'decrypt';

            } catch(err) {
              await ctx.reply('Error deocoding trade', markdown);
              logger.error({err});
            }
        });

        //decrypt a closed trade
        router.route('decrypt', async (ctx) => {
          try{
            const askForImage = ctx.msg.text;

            const decryptedTrade = await decryptTradeSecret({
              lnd: lnd.lnd,
              auth: ctx.session.decryptDetails.auth,
              from: ctx.session.decodedPaymentRequest.destination,
              payload: ctx.session.decodeDetails.secret.payload,
              secret: askForImage,
            });
            await ctx.reply(`Secret is: \n\n${hexAsUtf8(decryptedTrade.plain)}`, markdown);
            ctx.session.step = 'idle';
            } catch(err) {
              await ctx.reply('Error getting decoded trade', markdown);
              logger.error({err});
            }
        });

        //decrypt an open trade
        router.route('decrypt-opentrade', async (ctx) => {
          try{
            const askForImage = ctx.msg.text;

            const decryptedTrade = await decryptTradeSecret({
              lnd: lnd.lnd,
              auth: ctx.session.decryptDetails.auth,
              from: ctx.session.decryptDetails.from,
              payload: ctx.session.decryptDetails.payload,
              secret: askForImage,
            });
            await ctx.reply(`Secret is: \n\n${hexAsUtf8(decryptedTrade.plain)}`, markdown);

            //end the session variables after trade is displayed
            ctx.session.decryptDetails = undefined;
            ctx.session.step = 'idle';
            } catch(err) {
              await ctx.reply('Error getting decoded trade', markdown);
              logger.error({err});
            }
        });

        //chat replies trade complete if user enters an input after the trade completes
        router.route('idle', async (ctx) => {
          await ctx.reply('Trade decode complete, start over with /trade command', markdown);
        });

      }],

      //creates a closed trade request
      handleCreateClosedTradeRoute: [
      'validate',
       async ({}) => {
         //exit early if not creating a closed trade
        if(trade !== 'create-closed-trade') {
            return;
        }
        await ctx.reply('Enter the public key you are trading with?', );
        ctx.session.step = 'pubkey';   
      
        //get the pubkey you want to encode a trade with
        router.route('pubkey', async (ctx) => {
          try{
            const pubkey = ctx.msg.text;

            if(!isPublicKey(pubkey)) {
              await ctx.reply('Enter a valid public key');
              return;
            }
            ctx.session.pubkey = pubkey;
          await ctx.reply('Got the pubkey, describe the secret you are offering:', markdown );
          ctx.session.step = 'description';
        } catch(err) {
          logger.error({err});
        }
        });
      
      // get the description of the trade
        router.route('description', async (ctx) => {
          try {

          const description = ctx.msg.text;
            if(description.length > maxDescriptionLength) {
            await ctx.reply('Description too long, enter a shorer one');
            return;
            }
          ctx.session.description = description;
          await ctx.reply('Got the description, enter the secret you want to sell:', markdown );
          ctx.session.step = 'secret';
        } catch(err) {
          logger.error({err});
        }
        });
    
      //get the secret you are trading
        router.route('secret', async (ctx) => {
        try {
          const secret = ctx.msg.text;
          if(secret.length > maxSecretLength) {
            await ctx.reply('Secret too long, enter a shorer one');
            return;
          }
          ctx.session.secret = secret;
          await ctx.reply('Got it! How much do you want to charge?', markdown);
          ctx.session.step = 'price';
        } catch(err) {
          logger.error({err});
        }
        });
    
        //get the price of the trade
        router.route('price', async (ctx) => {
          try {
            const price = ctx.message.text;    
            ctx.session.price = asNumber(price);
          
            if(!ctx.session.secret || !ctx.session.pubkey || !ctx.session.description || !ctx.session.price) {
            await ctx.reply('Could not register the inputs, start over again with the /trade command', markdown);
            return;
            }

          //generate the closed trade
          await ctx.reply('Generating trade secret...');
          const tradeSecret = await finalizeTradeSecret({
            lnd: lnd.lnd,
            description: ctx.session.description,
            secret: ctx.session.secret,
            to: ctx.session.pubkey,
            tokens: asNumber(ctx.session.price),        
            });
            await ctx.reply(tradeSecret.trade, markdown);
            ctx.session.step = 'idle';
        } catch (err) {
          await ctx.reply('Error generating trade secret, try again with the /trade command', markdown);
          logger.error({err});
        }
        });

        //chat replies trade complete if user enters an input after the trade completes
        router.route('idle', async (ctx) => {
          await ctx.reply('Create trade complete, start over with /trade command');
        });
      }],

      //creates open trade requests
      handleCreateOpenTradeRoute: [
      'validate',
      'getChannels',
      'getIdentity',
      'getNetwork',
      async ({getChannels, getIdentity, getNetwork}) => {

        //exit early if not creating an open trade
        if(trade !== 'create-open-trade') {
          return;
        }

        await ctx.reply('Describe the secret you are offering.');
        ctx.session.step = 'description';

        //get description of the open trade
        router.route('description', async (ctx) => {
          try {
            const description = ctx.msg.text;
            if(description.length > maxDescriptionLength) {
            await ctx.reply('Description too long, enter a shorer one');
            return;
            }
            ctx.session.description = description;
            await ctx.reply('Got the description, enter the secret you want to sell:', markdown );
            ctx.session.step = 'secret';
          } catch(err) {
            logger.error({err});
          }
          });

          //get the secret of the open trade
        router.route('secret', async (ctx) => {
          try {
            const secret = ctx.msg.text;
            if(secret.length > maxSecretLength) {
              await ctx.reply('Secret too long, enter a shorer one');
              return;
            }
            ctx.session.secret = secret;
            await ctx.reply('Got it! How much do you want to charge?', markdown);
            ctx.session.step = 'price';
          } catch(err) {
            logger.error({err});
          }
        });

        //get the price of open trade
        router.route('price', async (ctx) => {
          try {
            const price = ctx.message.text;    
            ctx.session.price = asNumber(price);
          
            if(!ctx.session.secret || !ctx.session.description || !ctx.session.price) {
              await ctx.reply('Could not register the inputs, start over again with the /trade command', markdown);
              return;
            }

            await ctx.replyWithChatAction('typing');
            await ctx.reply('Generating trade secret...');

            // Encode the open trade details to give out
            const openTrade = encodeOpenTrade({
            network: getNetwork.network,
            nodes: [{
              channels: getChannels.channels,
              id: getIdentity.public_key,
              sockets: (getIdentity.uris || []).map(uriAsSocket),
            }]
          });
          
          const settled = [];
          
          //start listener on creating open trade
          const sub = serviceTradeRequests({
            lnd: lnd.lnd,
            description: ctx.session.description,
            secret: ctx.session.secret,
            tokens: asNumber(ctx.session.price),
          });
          
          sub.on('details', async ({to}) => {
            const {alias, id} = await getNodeAlias({lnd: lnd.lnd, id: to});
            return await ctx.reply(`Returning trade information to ${alias}`, markdown);
          });
          
          sub.once('end', async () => {
            const [to] = settled;
            
            if (!!to) {
              const {alias, id} = await getNodeAlias({lnd: lnd.lnd, id: to});
              return await ctx.reply(`Finished trade with ${alias}`, markdown);
            }
            
            return;
          });
          
          sub.on('failure', failure => logger.error({failure}));
          
          sub.on('settled', ({to}) => settled.push(to));

          
          await ctx.reply(`Trade created: ${openTrade.trade}`);
          ctx.session.step = 'idle';
          return logger.info({waiting_for_trade_request_to: openTrade.trade});
          } catch (err) {
            await ctx.reply('Error generating trade secret, try again with the /trade command', markdown);
            logger.error({err});
          }
        });


        //chat replies trade complete if user enters an input after the trade completes
        router.route('idle', async (ctx) => {
          await ctx.reply('Create trade complete, start over with /trade command');
        });
      }],
    },
  returnResult({reject, resolve, of: 'handlePurchaseTradeRoute'}, cbk));
  });
};