const asyncAuto = require('async/auto');
const {parsePaymentRequest} = require('ln-service');


const {returnResult} = require('asyncjs-util');
const decodeTrade = require('paid-services/trades/decode_trade');
const decryptTradeSecret = require('paid-services/trades/decrypt_trade_secret');
const finalizeTradeSecret = require('paid-services/trades/finalize_trade_secret');
const asNumber = n => parseFloat(n, 10);
const {floor} = Math;
const isNumber = n => !isNaN(n);
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const maxDescriptionLength = 100;
const maxSecretLength = 100;
const utf8AsHex = utf8 => Buffer.from(utf8).toString('hex');
const hexAsUtf8 = hex => Buffer.from(hex, 'hex').toString();


module.exports = ({lnd, trade, ctx, router, markdown, logger}, cbk) => {
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

    handlePurchaseRoute: [
    'validate',
    async ({}) => {
      if(trade !== 'purchase') {
        return;
      }

    await ctx.reply('Enter the trade to decode for invoice', markdown);
    ctx.session.step = 'decode-invoice';
  
    router.route('decode-invoice', async (ctx) => {
      try{
          const askForTrade = ctx.msg.text;
          const details = decodeTrade({trade: askForTrade});
          ctx.session.trade = askForTrade;
          await ctx.reply(`Invoice to pay is: \n ${details.secret.request}`, markdown);
          ctx.session.step = 'idle';
          } catch(err) {
            await ctx.reply('Error deocoding trade', markdown);
            logger.error({err});
          }
      });

    router.route('idle', async (ctx) => {
      await ctx.reply('Decoding invoice complete, start over with /trade command');
    });

    }],

    handleDecryptRoute: [
    'validate',
    async ({}) => {
      if(trade !== 'decrypt') {
          return;
      }
      await ctx.reply('Enter the trade again?', markdown);
      ctx.session.step = 'decode';
  
      router.route('decode', async (ctx) => {
        try{
            const askForTrade = ctx.msg.text;
            const decodeDetails = decodeTrade({trade: askForTrade});
            const decodedTrade = parsePaymentRequest({request: decodeDetails.secret.request});

            ctx.session.decodeDetails = decodeDetails;
            ctx.session.decodetrade = decodedTrade;
            await ctx.reply('Enter the preimage?', markdown);
            ctx.session.step = 'decrypt';

            } catch(err) {
              await ctx.reply('Error deocoding trade', markdown);
              logger.error({err});
            }
      });

      router.route('decrypt', async (ctx) => {
        try{
            const askForImage = ctx.msg.text;

            const decryptedTrade = await decryptTradeSecret({
              lnd: lnd.lnd,
              auth: ctx.session.decodeDetails.secret.auth,
              from: ctx.session.decodetrade.destination,
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

      router.route('idle', async (ctx) => {
        await ctx.reply('Trade decode complete, start over with /trade command', markdown);
      });

    }],

    handleCreateTradeRoute: [
      'validate',
       async ({}) => {
        if(trade !== 'create') {
            return;
        }
      await ctx.reply('Enter the public key you are trading with?', );
      ctx.session.step = 'pubkey';   
      
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
    
    
      router.route('price', async (ctx) => {
        try {
          const price = ctx.message.text;    
          ctx.session.price = asNumber(price);
          
          if(!ctx.session.secret || !ctx.session.pubkey || !ctx.session.description || !ctx.session.price) {
            await ctx.reply('Could not register the inputs, start over again with the /trade command', markdown);
            return;
          }

          await ctx.replyWithChatAction('typing');
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

    router.route('idle', async (ctx) => {
      await ctx.reply('Create trade complete, start over with /trade command');
    });
  }],

  },
  returnResult({reject, resolve}, cbk));
  });
};