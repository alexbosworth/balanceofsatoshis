const asyncAuto = require('async/auto');
const {getIdentity} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {subscribeToChannels} = require('ln-service');
const {subscribeInvoices} = require('ln-service');
const {subscribeToPeerMessages} = require('ln-service');

const {methodCreateOrder} = require('./lsps1_protocol');
const {methodGetInfo} = require('./lsps1_protocol');
const {methodGetOrder} = require('./lsps1_protocol');
const processOrder = require('./process_order');
const sendOrder = require('./send_order');
const sendInfo = require('./send_info');
const {typeForMessaging} = require('./lsps1_protocol');
const {versionJsonRpc} = require('./lsps1_protocol');

const decodeMessage = n => JSON.parse(Buffer.from(n, 'hex').toString());
const isMap = n => n instanceof Map;
const isNumber = n => !isNaN(n);

/** Run the LSPS1 Service

  {
    base_fee: <Base Fee Tokens Number>
    fee_rate: <Proportional Capacity Fee in Parts Per Million Tokens Number>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    max_capacity: <Maximum Capacity Tokens Number>
    min_capacity: <Minimum Capacity Tokens Number>
    orders: <Orders Map Object>
    private_fee_rate: <Proportional Added Fee PPM for Private Channels Number>
    [website]: <Website String>
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (args.base_fee === undefined || !isNumber(args.base_fee)) {
          return cbk([400, 'ExpectedBaseFeeToRunLsp1Server']);
        }

        if (args.fee_rate === undefined || !isNumber(args.fee_rate)) {
          return cbk([400, 'ExpectedFeeRateToRunLsp1Server']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToRunLsp1Server']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToRunLsp1Server']);
        }

        if (!args.max_capacity || !isNumber(args.max_capacity)) {
          return cbk([400, 'ExpectedMaxCapacityToRunLsp1Server']);
        }

        if (!args.min_capacity || !isNumber(args.min_capacity)) {
          return cbk([400, 'ExpectedMinCapacityToRunLsp1Server']);
        }

        if (!isMap(args.orders)) {
          return cbk([400, 'ExpectedOrdersDataStoreToRunLsp1Server']);
        }

        if (args.private_fee_rate === undefined) {
          return cbk([400, 'ExpectedPrivateFeeRateToRunLsp1Server']);
        }

        // Make sure the website is a valid URL
        if (!!args.website) {
          try {
            new URL(args.website);
          } catch (err) {
            return cbk([400, 'ExpectedValidUrlToRunLsp1Server']);
          }
        }

        return cbk();
      },

      // Get the node identity to show what server is advertising the opens
      getId: ['validate', ({}, cbk) => getIdentity({lnd: args.lnd}, cbk)],

      // Serve LSPS1 open requests
      run: ['getId', ({getId}, cbk) => {
        const subChannels = subscribeToChannels({lnd: args.lnd});
        const subMessages = subscribeToPeerMessages({lnd: args.lnd});

        args.logger.info({lsp_server_running: getId.public_key});

        subChannels.on('channel_opened', opened => {
          return args.logger.info({
            detected_channel_open_to: opened.partner_public_key,
          });
        });

        subMessages.on('message_received', async received => {
          // Exit early when a peer message is not for the LSPS1 type
          if (received.type !== typeForMessaging) {
            return;
          }

          // Exit early when a peer message is not JSON
          try {
            decodeMessage(received.message);
          } catch (err) {
            return;
          }

          const message = decodeMessage(received.message);

          // Exit early when the JSON is not specified as JSON RPC
          if (message.jsonrpc !== versionJsonRpc) {
            return;
          }

          switch (message.method) {
          case methodCreateOrder:
            try {
              return await processOrder({
                base_fee: args.base_fee,
                fee_rate: args.fee_rate,
                lnd: args.lnd,
                logger: args.logger,
                max_capacity: args.max_capacity,
                message: received.message,
                min_capacity: args.min_capacity,
                orders: args.orders,
                private_fee_rate: args.private_fee_rate,
                to_peer: received.public_key,
              });
            } catch (err) {
              return args.logger.error({err});
            }

          case methodGetInfo:
            try {
              return await sendInfo({
                max_capacity: args.max_capacity,
                message: received.message,
                min_capacity: args.min_capacity,
                lnd: args.lnd,
                to_peer: received.public_key,
                website: args.website,
              });
            } catch (err) {
              return args.logger.error({err});
            }

          case methodGetOrder:
            try {
              return await sendOrder({
                lnd: args.lnd,
                logger: args.logger,
                orders: args.orders,
                message: received.message,
                to_peer: received.public_key,
              });
            } catch (err) {
              return args.logger.error({err});
            }

          default:
            break;
          }
        });

        subChannels.on('error', err => {
          args.logger.error([503, 'UnexpectedErrInChansSubscription', {err}]);

          subChannels.removeAllListeners();
          subMessages.removeAllListeners();

          return cbk();
        });

        subMessages.on('error', err => {
          args.logger.error([503, 'UnexpectedErrInMsgsSubscription', {err}]);

          subChannels.removeAllListeners();
          subMessages.removeAllListeners();

          return cbk();
        });
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
