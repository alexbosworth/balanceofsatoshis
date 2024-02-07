const asyncAuto = require('async/auto');
const asyncDetectSeries = require('async/detectSeries');
const {returnResult} = require('asyncjs-util');

const {addPeer} = require('ln-service');
const {createChainAddress} = require('ln-service');
const {getNode} = require('ln-service');
const {sendMessageToPeer} = require('ln-service');
const {subscribeToPeerMessages} = require('ln-service');

const buyChannel = require('./buy_channel');
const {constants} = require('./constants.json');
const {requests} = require('./requests.json');

const decodeMessage = n => Buffer.from(n, 'hex').toString();
const encodeMessage = n => Buffer.from(JSON.stringify(n)).toString('hex');
const format = 'p2wpkh';
const hoursAsBlocks = n => n * 6;
const isNumber = n => !isNaN(n);
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const knownTypes = ['private', 'public'];
const {parse} = JSON;
const peerAddedDelayMs = 1000 * 5;
const publicType = 'public';
const times = 10;


module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguements
      validate: cbk => {
        if (!args.ask) {
          return cbk([400, 'ExpectedAskFunctionToRunLspClient']);
        }
        
        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToRunLspClient']);
        }
        
        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToRunLspClient']);
        }
        
        if (!args.max_wait_hours || !isNumber(args.max_wait_hours)) {
          return cbk([400, 'ExpectedMaxWaitHoursToRunLspClient']);
        }
        
        if (!args.pubkey || !isPublicKey(args.pubkey)) {
          return cbk([400, 'ExpectedValidHexPubkeyToRunLspClient']);
        }
        
        if (!args.tokens || !isNumber(args.tokens)) {
          return cbk([400, 'ExpectedAmountToRunLspClient']);
        }
        
        if (!args.type) {
          return cbk([400, 'ExpectedChannelTypeToRunLspClient']);
        }
        
        if (!knownTypes.includes(args.type)) {
          return cbk([400, 'ExpectedKnownChannelTypeToRunLspClient']);
        }
        
        return cbk();
      },
      
      // Get node info
      getNodeInfo: ['validate', ({}, cbk) => {
        return getNode({
          lnd: args.lnd, 
          public_key: args.pubkey, 
          is_omitting_channels: true
        }, cbk);
      }],
      
      // Connect to node
      connect: ['getNodeInfo', ({getNodeInfo}, cbk) => {
        const {sockets} = getNodeInfo;
        
        if (!sockets.length) {
          return cbk([503, 'NoAddressesFoundForNodeToConnectToNode']);
        }
        
        return asyncDetectSeries(sockets, ({socket}, cbk) => {
          return addPeer({
            socket, 
            lnd: args.lnd, 
            public_key: args.pubkey, 
            retry_count: times, 
            retry_delay: peerAddedDelayMs
          }, err => {
            return cbk(null, !err);
          });
        },
        cbk);
      }],
      
      // Subscribe to server messages
      subscribe: ['connect', ({}, cbk) => {
        const sub = subscribeToPeerMessages({lnd: args.lnd});
        
        sub.on('message_received', async n => {
          try {
            if (!n.type || n.type !== constants.messageType) {
              return;
            }
            
            const message = parse(decodeMessage(n.message));
            
            if (!!message.error) {
              args.logger.error({error: message.error});
            }
            
            if (!message.jsonrpc || message.jsonrpc !== constants.jsonrpc || !message.result) {
              return;
            }
            
            // Log the order info and exit
            if (!!args.is_dry_run) {
              args.logger.info(message.result.options);
              
              sub.removeAllListeners();
              return;
            }
            
            if (!!args.recovery) {
              args.logger.info(message.result);
              
              sub.removeAllListeners();
              return;
            }
            
            if (!args.is_dry_run && !args.recovery) {
              await buyChannel({
                announce_channel: args.type === publicType,
                ask: args.ask,
                lnd: args.lnd,
                logger: args.logger,
                message: message.result,
                priority: hoursAsBlocks(args.max_wait_hours),
                pubkey: n.public_key,
                tokens: args.tokens,
                type: n.type,
              });

              args.logger.info({is_payment_sent: true});
            }
          } catch (err) {
            args.logger.error({err});
          }
        });
        
        sub.on('error', err => {
          sub.removeAllListeners();
        });
        
        return cbk();
      }],
      
      // Generate refund address
      getRefundAddress: ['subscribe', ({}, cbk) => {
        // Exit early if this is a dry run or recovery
        if (!!args.is_dry_run || !!args.recovery) {
          return cbk();
        }
        
        return createChainAddress({format, lnd: args.lnd}, cbk);
      }],
      
      // Send order for inbound channel
      sendBuyOrder: ['getRefundAddress', 'subscribe', ({getRefundAddress}, cbk) => {
        // Exit early if this is a dry run or recovery
        if (!!args.is_dry_run || !!args.recovery) {
          return cbk();
        }
        
        const order = requests.lsps1CreateOrderRequest;
        order.params.announce_channel = args.type === publicType;
        order.params.channel_expiry_blocks = constants.channelExpiryBlocks;
        order.params.confirms_within_blocks = hoursAsBlocks(args.max_wait_hours);
        order.params.lsp_balance_sat = args.tokens;
        order.params.refund_onchain_address = getRefundAddress.address;
        
        const message = encodeMessage(order);
        
        return sendMessageToPeer({
          message,
          lnd: args.lnd,
          public_key: args.pubkey,
          type: constants.messageType,
        }, cbk);
      }],
      
      // Send getinfo request
      requestInfo: ['subscribe', ({}, cbk) => {
        // Exit early if not requesting info
        if (!args.is_dry_run) {
          return cbk();
        }
        
        const message = encodeMessage(requests.lsps1GetinfoRequest);
        
        return sendMessageToPeer({
          message,
          lnd: args.lnd,
          public_key: args.pubkey,
          type: constants.messageType,
        }, cbk);
      }],
      
      // Check order status
      checkOrder: ['subscribe', ({}, cbk) => {
        // Exit early if not checking order status
        if (!args.recovery) {
          return cbk();
        }
        
        const orderStatusMessage = requests.lsps1GetOrderRequest;
        orderStatusMessage.params.order_id = args.recovery;
        
        return sendMessageToPeer({
          message: encodeMessage(orderStatusMessage),
          lnd: args.lnd,
          public_key: args.pubkey,
          type: constants.messageType,
        }, cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
