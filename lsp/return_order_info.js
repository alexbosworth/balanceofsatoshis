const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const {sendMessageToPeer} = require('ln-service');
const makeErrorMessage = require('./make_error_message');
const {requests} = require('./requests.json');
const {responses} = require('./responses.json');
const {constants} = require('./constants.json');


const decodeMessage = n => Buffer.from(n, 'hex').toString();
const encodeMessage = n => Buffer.from(JSON.stringify(n)).toString('hex');
const {parse} = JSON;


module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguements
      validate: cbk => {
        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToReturnOrderInfo']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToReturnOrderInfo']);
        }

        if (!args.message) {
          return cbk([400, 'ExpectedMessageToReturnOrderInfo']);
        }

        if (!args.pubkey) {
          return cbk([400, 'ExpectedPubkeyToReturnOrderInfo']);
        }

        if (!args.type) {
          return cbk([400, 'ExpectedTypeToReturnOrderInfo']);
        }

        try {
          parse(decodeMessage(args.message));
        } catch (e) {
          return cbk([400, 'ExpectedValidMessageToReturnOrderInfo']);
        }

        return cbk();
      },

      // Find order
      getOrder: ['validate', ({}, cbk) => {
        const message = parse(decodeMessage(args.message));

        if (!message.params) {
          const error = {
            error: makeErrorMessage({code: -32606, message: 'Invalid params', data: {
            property: 'params',
            message: 'MissingParamsInCreateOrderRequest'
          }})};

          return cbk(null, error);
        }

        if (!message.params.order_id) {
          const error = {
            error: makeErrorMessage({code: -32606, message: 'Invalid params', data: {
            property: 'order_id',
            message: 'MissingOrderIdInCreateOrderRequest'
          }})};

          return cbk(null, error);
        }

        const order = args.orders.get(message.params.order_id);

        if (!order) {
          const error = {
            error: makeErrorMessage({code: 404, message: 'Not found', data: {}})
          };

          return cbk(null, error);
        }

        return cbk(null, {message, order});
      }],

      // Send error response
      sendErrorMessage: ['getOrder', ({getOrder}, cbk) => {
        if (!getOrder.error) {
          return cbk();
        }

        return sendMessageToPeer({
          lnd: args.lnd,
          message: encodeMessage(getOrder.error),
          public_key: args.pubkey,
          type: args.type,
        },
        err => {
          if (!!err) {
            return cbk([503, 'UnexpectedErrorSendingGetinfoResponse', {err}]);
          }

          return cbk();
        });
      }],

      // Send order response
      sendOrderInfo: ['getOrder', ({getOrder}, cbk) => {
        if (!getOrder.order) {
          return cbk();
        }

        try {
          const order = parse(getOrder.order);

          return sendMessageToPeer({
            lnd: args.lnd,
            message: encodeMessage(order),
            public_key: args.pubkey,
            type: args.type,
          },
          err => {
            if (!!err) {
              return cbk([503, 'UnexpectedErrorSendingGetOrderResponse', {err}]);
            }
  
            return cbk();
          });
        } catch (err) {
          return cbk([503, 'ExpectedValidOrderInReturnOrderInfo', {err}]);
        }

      }],
    },
    returnResult({reject, resolve}, cbk));
  });
}