const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const {subscribeToPeerMessages} = require('ln-service');

const {constants} = require('./constants.json');
const processOrder = require('./process_order');
const returnOrderInfo = require('./return_order_info');
const sendInfo = require('./send_info');

const decodeMessage = n => Buffer.from(n, 'hex').toString();
const isNumber = n => !isNaN(n);
const orders = new Map();
const {parse} = JSON;
const {requests} = require('./requests.json');

module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguements
      validate: cbk => {
        if (args.fee_rate === undefined || !isNumber(args.fee_rate)) {
          return cbk([400, 'ExpectedFeeRateToRunLspServer']);
        }

        if (!args.max_capacity || !isNumber(args.max_capacity)) {
          return cbk([400, 'ExpectedMaxCapacityToRunLspServer']);
        }

        if (!args.min_capacity || !isNumber(args.min_capacity)) {
          return cbk([400, 'ExpectedMinCapacityToRunLspServer']);
        }

        if (!args.min_onchain_payment_size || !isNumber(args.min_onchain_payment_size)) {
          return cbk([400, 'ExpectedMinOnchainPaymentSizeToRunLspServer']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToRunLspServer']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToRunLspServer']);
        }

        return cbk();
      },

      // Subscribe to clients
      subscribe: ['validate', ({}, cbk) => {
        const sub = subscribeToPeerMessages({lnd: args.lnd});

        args.logger.info({is_lsp_server_running: true});

        sub.on('message_received', async n => {
          try {
            if (!n.type || n.type !== constants.messageType) {
              return;
            }

            const message = parse(decodeMessage(n.message));

            if (!message.jsonrpc || message.jsonrpc !== constants.jsonrpc) {
              return;
            }

            if (message.method === requests.lsps1GetinfoRequest.method) {
              await sendInfo({
                max_capacity: args.max_capacity,
                message: n.message,
                min_capacity: args.min_capacity,
                min_onchain_payment_size: args.min_onchain_payment_size,
                lnd: args.lnd,
                logger: args.logger,
                pubkey: n.public_key,
                type: n.type,
              });
            }

            if (message.method === requests.lsps1CreateOrderRequest.method) {
              await processOrder({
                orders,
                fee_rate: args.fee_rate,
                max_capacity: args.max_capacity,
                message: n.message,
                min_capacity: args.min_capacity,
                min_onchain_payment_size: args.min_onchain_payment_size,
                lnd: args.lnd,
                logger: args.logger,
                pubkey: n.public_key,
                type: n.type,
              });
            }

            if (message.method === requests.lsps1GetOrderRequest.method) {
              await returnOrderInfo({
                orders,
                message: n.message,
                lnd: args.lnd,
                logger: args.logger,
                pubkey: n.public_key,
                type: n.type,
              })
            }

          } catch (err) {
            //Ignore errors
            args.logger.error({err});
          }
        });

        sub.on('error', err => {
          args.logger.error('Error in peer message subscription', {err});

          sub.removeAllListeners();

          return cbk();
        });
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
