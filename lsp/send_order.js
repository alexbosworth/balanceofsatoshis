const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');
const {sendMessageToPeer} = require('ln-service');

const {codeInvalidParameters} = require('./lsps1_protocol');
const {codeResourceNotFound} = require('./lsps1_protocol');
const {errMessageNotFound} = require('./lsps1_protocol');
const {errMessageInvalidParams} = require('./lsps1_protocol');
const {typeForMessaging} = require('./lsps1_protocol');
const {versionJsonRpc} = require('./lsps1_protocol');

const decodeMessage = hex => JSON.parse(Buffer.from(hex, 'hex').toString());
const encodeMessage = obj => Buffer.from(JSON.stringify(obj)).toString('hex');
const {parse} = JSON;

/** Send the status of a previously created order

  {
    orders: <LSPS1 Orders Map Object>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    message: <Received Message String>
    to_peer: <Send Status To Peer With Identity Public Key Hex String>
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
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

        try {
          decodeMessage(args.message);
        } catch (e) {
          return cbk([400, 'ExpectedValidMessageToReturnOrderInfo']);
        }

        if (!args.to_peer) {
          return cbk([400, 'ExpectedToPeerIdentityPublicKeyToSendOrderInfo']);
        }

        return cbk();
      },

      // Make the terms response
      response: ['validate', ({}, cbk) => {
        const {id, params} = decodeMessage(args.message);

        // A response cannot be returned when there is no request id
        if (!id) {
          return cbk([400, 'ExpectedMessageIdToSendLsps1ChannelOrderStatus']);
        }

        // Exit early when params are missing
        if (!params) {
          return cbk(null, {
            id,
            error: {
              code: codeInvalidParameters,
              data: {
                message: 'MissingParamsInGetOrderRequest',
                property: 'params',
              },
              message: errMessageInvalidParams,
            },
          });
        }

        if (!params.order_id) {
          return cbk(null, {
            id,
            error: {
              code: codeInvalidParameters,
              data: {
                message: 'MissingOrderIdInGetOrderStatusRequest',
                property: 'order_id',
              },
              message: errMessageInvalidParams,
            },
          });
        }

        const order = args.orders.get(params.order_id);

        if (!order) {
          return cbk(null, {
            id,
            error: {
              code: codeResourceNotFound,
              data: {},
              message: errMessageNotFound,
            },
          });

          return cbk(null, error);
        }

        return cbk(null, {id, result: parse(order).result});
      }],

      // Send the order response via p2p messaging
      sendMessage: ['response', ({response}, cbk) => {
        return sendMessageToPeer({
          lnd: args.lnd,
          message: encodeMessage({
            error: response.error || undefined,
            id: response.id,
            jsonrpc: versionJsonRpc,
            result: response.result || undefined,
          }),
          public_key: args.to_peer,
          type: typeForMessaging,
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
