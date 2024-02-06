const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');
const {sendMessageToPeer} = require('ln-service');

const {constants} = require('./constants.json');
const makeErrorMessage = require('./make_error_message');
const {requests} = require('./requests.json');
const {responses} = require('./responses.json');

const decodeMessage = n => Buffer.from(n, 'hex').toString();
const encodeMessage = n => Buffer.from(JSON.stringify(n)).toString('hex');
const {parse} = JSON;


module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguements
      validate: cbk => {
        if (!args.max_capacity) {
          return cbk([400, 'ExpectedMaxCapacityToSendInfoMessage']);
        }

        if (!args.min_capacity) {
          return cbk([400, 'ExpectedMinCapacityToSendInfoMessage']);
        }

        if (!args.min_onchain_payment_size) {
          return cbk([400, 'ExpectedMinOnchainPaymentSizeToSendInfoMessage']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToSendInfoMessage']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToSendInfoMessage']);
        }

        if (!args.message) {
          return cbk([400, 'ExpectedMessageToSendInfoMessage']);
        }

        if (!args.pubkey) {
          return cbk([400, 'ExpectedPubkeyToSendInfoMessage']);
        }

        if (!args.type) {
          return cbk([400, 'ExpectedTypeToSendInfoMessage']);
        }

        try {
          parse(decodeMessage(args.message));
        } catch (e) {
          return cbk([400, 'ExpectedValidMessageToSendInfoMessage']);
        }

        return cbk();
      },

      // Send getinfo response
      sendInfoMessage: ['validate', ({}, cbk) => {
        try {
          const message = parse(decodeMessage(args.message));

          if (!message.params) {
            const error = {
              error: makeErrorMessage({code: -32606, message: 'Invalid params', data: {
              property: 'params',
              message: 'MissingParamsInCreateOrderRequest'
            }})};

            return sendMessageToPeer({
              lnd: args.lnd,
              message: encodeMessage(error),
              public_key: args.pubkey,
              type: args.type,
            }, cbk);
          }

          const responseMessage = responses.lsps1GetinfoResponse;

          responseMessage.result.website = args.website || '';
          responseMessage.result.options.max_channel_balance_sat = args.max_capacity;
          responseMessage.result.options.min_onchain_payment_confirmations = constants.minOnchainConfs;
          responseMessage.result.options.min_onchain_payment_size_sat = args.min_onchain_payment_size;
          responseMessage.result.options.max_channel_expiry_blocks = constants.channelExpiryBlocks;
          responseMessage.result.options.min_initial_client_balance_sat = constants.minPushAmount;
          responseMessage.result.options.max_initial_client_balance_sat = constants.maxPushAmount;
          responseMessage.result.options.min_channel_balance_sat = args.min_capacity;
          responseMessage.result.options.min_channel_confirmations = constants.minChannelConfs;
          responseMessage.result.options.min_initial_lsp_balance_sat = args.min_capacity;
          responseMessage.result.options.max_initial_lsp_balance_sat = args.max_capacity;
          responseMessage.id = message.id;

          // Your max local balance is same as max capacity
          responseMessage.result.options.max_initial_lsp_balance_sat = args.max_capacity;

          return sendMessageToPeer({
            lnd: args.lnd,
            message: encodeMessage(responseMessage),
            public_key: args.pubkey,
            type: args.type,
          }, cbk);
        } catch (err) {
          return cbk([400, 'FailedToSendInfoMessage', {err}]);
        }
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};