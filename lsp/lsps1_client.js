const asyncAuto = require('async/auto');
const asyncRetry = require('async/retry');
const asyncDetectSeries = require('async/detectSeries');

const {returnResult} = require('asyncjs-util');
const {getNode} = require('ln-service');
const {sendMessageToPeer} = require('ln-service');
const {addPeer} = require('ln-service');
const {subscribeToPeerMessages} = require('ln-service');

const sendInfo = require('./send_info');
const processOrder = require('./process_order');
const returnOrderInfo = require('./return_order_info');
const {constants} = require('./constants.json');
const requestInfo = require('./request_info');
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


module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguements
      validate: cbk => {
        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToRunLspClient']);
        }
        
        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToRunLspClient']);
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
        return getNode({lnd: args.lnd, public_key: args.pubkey, is_omitting_channels: true}, cbk);
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
            
            if (!message.jsonrpc || message.jsonrpc !== constants.jsonrpc || !message.result) {
              return;
            }
            
            if (!!message.error) {
              args.logger.error({error: message.error});
            }
            
            if (!!message.result.options) {
              args.logger.info(message.result.options);
            }
          } catch (err) {
            args.logger.error({err});
          }
        });
        
        return cbk();
      }],
      
      // Send getinfo request
      sendGetinfo: ['subscribe', ({}, cbk) => {
        const message = encodeMessage(requests.lsps1GetinfoRequest);

        return sendMessageToPeer({
          message,
          lnd: args.lnd,
          public_key: args.pubkey,
          type: constants.messageType,
        }, cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
