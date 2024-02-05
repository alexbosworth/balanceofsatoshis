const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');
const {subscribeToPeerMessages} = require('ln-service');
const {createInvoice} = require('ln-service');
const {subscribeToInvoice} = require('ln-service');
const {openChannel} = require('ln-service');
const {sendMessageToPeer} = require('ln-service');
const info = require('./info');
const order = require('./order');
const decodeMessage = (n) => Buffer.from(n, 'hex').toString();
const encodeMessage = (n) => Buffer.from(JSON.stringify(n)).toString('hex');
const messageType = 37913;
const isNumber = n => !isNaN(n);
const orders = new Map();


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
            if (!n.type || n.type !== messageType) {
              return;
            }

            await info({
              max_capacity: args.max_capacity,
              message: n.message,
              min_capacity: args.min_capacity,
              min_onchain_payment_size: args.min_onchain_payment_size,
              lnd: args.lnd,
              logger: args.logger,
              pubkey: n.public_key,
              type: n.type,
            });

            await order({
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
