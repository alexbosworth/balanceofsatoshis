const asyncAuto = require('async/auto');
const asyncDetectSeries = require('async/detectSeries');

const {returnResult} = require('asyncjs-util');
const {createChainAddress} = require('ln-service');
const {getNode} = require('ln-service');
const {sendMessageToPeer} = require('ln-service');
const {addPeer} = require('ln-service');
const {subscribeToPeerMessages} = require('ln-service');

const buyChannel = require('./buy_channel');
const {constants} = require('./constants.json');
const isNumber = n => !isNaN(n);
const orders = new Map();
const decodeMessage = n => Buffer.from(n, 'hex').toString();
const encodeMessage = n => Buffer.from(JSON.stringify(n)).toString('hex');
const {parse} = JSON;
const {requests} = require('./requests.json');
const minPriority = 2;
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const knownTypes = ['private', 'public'];
const peerAddedDelayMs = 1000 * 5;
const times = 10;
const publicType = 'public';
const format = 'p2wpkh';


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
        
        if (!args.method || !constants.methods[args.method]) {
          return cbk([400, 'ExpectedKnownMethodToRunLspClient']);
        }
        
        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToRunLspClient']);
        }

        if (constants.methods[args.method] === constants.methods['check-order'] && !args.order_id) {
          return cbk([400, 'ExpectedOrderIdToRunLspClient']);
        }

        if (!args.priority || !isNumber(args.priority)) {
          return cbk([400, 'ExpectedPriorityToRunLspClient']);
        }
        
        if (args.priority < minPriority) {
          return cbk([400, 'ExpectedHigherPriorityToRunLspClient']);
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

            if (constants.methods[args.method] === constants.methods['buy-channel']) {
              await buyChannel({
                announce_channel: args.type === publicType,
                ask: args.ask,
                lnd: args.lnd,
                logger: args.logger,
                message: message.result,
                priority: args.priority,
                pubkey: n.public_key,
                tokens: args.tokens,
                type: n.type,
              })
            }

            if (constants.methods[args.method] === constants.methods['check-order']) {

              args.logger.info(message.result);
              sub.removeAllListeners();
            }

            // Log the order info and exit
            if (constants.methods[args.method] === constants.methods['request-info']) {
              args.logger.info(message.result.options);
              sub.removeAllListeners();
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
        if (constants.methods[args.method] !== constants.methods['buy-channel']) {
          return cbk();
        }
        
        return createChainAddress({format, lnd: args.lnd}, cbk);
      }],

      // Send order for inbound channel
      sendBuyOrder: ['getRefundAddress', 'subscribe', ({getRefundAddress}, cbk) => {
        if (constants.methods[args.method] !== constants.methods['buy-channel']) {
          return cbk();
        }

        const order = requests.lsps1CreateOrderRequest;
        order.params.announce_channel = args.type === publicType;
        order.params.channel_expiry_blocks = constants.channelExpiryBlocks;
        order.params.confirms_within_blocks = args.priority;
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
        if (constants.methods[args.method] !== constants.methods['request-info']) {
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
        if (constants.methods[args.method] !== constants.methods['check-order']) {
          return cbk();
        }

        const orderStatusMessage = requests.lsps1GetOrderRequest;
        orderStatusMessage.params.order_id = args.order_id;

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
