const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');
const {randomBytes} = require('crypto');

const {sendMessageToPeer} = require('ln-service');

const {requests} = require('./requests.json');
const {responses} = require('./responses.json');

const decodeMessage = n => Buffer.from(n, 'hex').toString();
const encodeMessage = n => Buffer.from(JSON.stringify(n)).toString('hex');
const {parse} = JSON;
const {stringify} = JSON;
const makeOrderId = () => randomBytes(32).toString('hex');
const isNumber = n => !isNaN(n);
const sumOf = (a, b) => a + b;


module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguements
      validate: cbk => {
        if (!args.max_capacity) {
          return cbk([400, 'ExpectedMaxCapacityToSendOrderMessage']);
        }

        if (!args.max_channel_expiry) {
          return cbk([400, 'ExpectedMaxChannelExpiryToSendOrderMessage']);
        }

        if (!args.max_push_amount)  {
          return cbk([400, 'ExpectedMaxPushAmountToSendOrderMessage']);
        }

        if (!args.min_capacity) {
          return cbk([400, 'ExpectedMinCapacityToSendOrderMessage']);
        }

        if (args.min_channel_confs === undefined) {
          return cbk([400, 'ExpectedMinChannelConfsToSendOrderMessage']);
        }

        if (!args.min_onchain_confs) {
          return cbk([400, 'ExpectedMinOnchainConfsToSendOrderMessage']);
        }

        if (!args.min_onchain_payment_size) {
          return cbk([400, 'ExpectedMinOnchainPaymentSizeToSendOrderMessage']);
        }

        if (!args.min_push_amount) {
          return cbk([400, 'ExpectedMinPushAmountToSendOrderMessage']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToSendOrderMessage']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToSendOrderMessage']);
        }

        if (!args.message) {
          return cbk([400, 'ExpectedMessageToSendOrderMessage']);
        }

        if (!args.pubkey) {
          return cbk([400, 'ExpectedPubkeyToSendOrderMessage']);
        }

        try {
          parse(decodeMessage(args.message));
        } catch (e) {
          return cbk([400, 'ExpectedValidMessageToSendOrderMessage']);
        }

        return cbk();
      },

      // Send order message
      makeMessage: ['validate', ({}, cbk) => {
        const message = parse(decodeMessage(args.message));

        if (message.method !== requests.lsps1CreateOrderRequest.method) {
          return cbk();
        }

        if (message.jsonrpc !== requests.lsps1CreateOrderRequest.jsonrpc) {
          return cbk();
        }

        if (!message.params) {
          const error = {
            error: makeErrorMessage({code: -32606, message: 'Invalid params', data: {
            property: 'params',
            message: 'MissingParamsInCreateOrderRequest'
          }})};

          return cbk(null, {error: encodeMessage(error)});
        }

        if (!message.params.lsp_balance_sat || !isNumber(message.params.lsp_balance_sat)) {
          const error = {
            error: makeErrorMessage({code: -32606, message: 'Invalid params', data: {
            property: 'lsp_balance_sat',
            message: 'MissingLspBalanceInCreateOrderRequest'
          }})};

          return cbk(null, {error: encodeMessage(error)});
        }

        if (!message.params.client_balance_sat || !isNumber(message.params.client_balance_sat)) {
          const error = {
            error: makeErrorMessage({code: -32606, message: 'Invalid params', data: {
            property: 'client_balance_sat',
            message: 'MissingClientBalanceInCreateOrderRequest'
          }})};

          return cbk(null, {error: encodeMessage(error)});
        }

        if (!message.params.confirms_within_blocks || !isNumber(message.params.confirms_within_blocks)) {
          const error = {
            error: makeErrorMessage({code: -32606, message: 'Invalid params', data: {
            property: 'confirms_within_blocks',
            message: 'MissingConfirmsWithinBlocksInCreateOrderRequest'
          }})};

          return cbk(null, {error: encodeMessage(error)});
        }

        if (!message.params.channel_expiry_blocks || !isNumber(message.params.channel_expiry_blocks)) {
          const error = {
            error: makeErrorMessage({code: -32606, message: 'Invalid params', data: {
            property: 'channel_expiry_blocks',
            message: 'MissingChannelExpiryBlocksInCreateOrderRequest'
          }})};

          return cbk(null, {error: encodeMessage(error)});
        }

        if (!message.params.refund_onchain_address) {
          const error = {
            error: makeErrorMessage({code: -32606, message: 'Invalid params', data: {
            property: 'refund_onchain_address',
            message: 'MissingRefundOnchainAddressInCreateOrderRequest'
          }})};

          return cbk(null, {error: encodeMessage(error)});
        }

        if (message.params.announceChannel === undefined) {
          const error = {
            error: makeErrorMessage({code: -32606, message: 'Invalid params', data: {
            property: 'announceChannel',
            message: 'MissingAnnounceChannelInCreateOrderRequest'
          }})};

          return cbk(null, {error: encodeMessage(error)});
        }

        if (Number(message.params.confirms_within_blocks) < Number(args.min_onchain_confs)) {
          const error = {
            error: makeErrorMessage({code: 1000, message: 'Option mismatch', data: {
            property: 'confirms_within_blocks',
            message: 'ConfirmsWithinBlocksTooLowInCreateOrderRequest'
          }})};

          return cbk(null, {error: encodeMessage(error)});
        }

        if (sumOf(Number(message.params.lsp_balance_sat), Number(message.params.client_balance_sat)) > Number(args.max_capacity)) {
          const error = {
            error: makeErrorMessage({code: 1000, message: 'Option mismatch', data: {
            property: 'lsp_balance_sat',
            message: 'OrderExceedingTotalCapacityInCreateOrderRequest'
          }})};

          return cbk(null, {error: encodeMessage(error)});
        }

        if (sumOf(Number(message.params.lsp_balance_sat), Number(message.params.client_balance_sat)) < Number(args.min_capacity)) {
          const error = {
            error: makeErrorMessage({code: 1000, message: 'Option mismatch', data: {
            property: 'lsp_balance_sat',
            message: 'OrderBelowMinCapacityInCreateOrderRequest'
          }})};

          return cbk(null, {error: encodeMessage(error)});
        }

        if (Number(message.params.client_balance_sat) < Number(args.min_push_amount)) {
          const error = {
            error: makeErrorMessage({code: 1000, message: 'Option mismatch', data: {
            property: 'client_balance_sat',
            message: 'ClientBalanceTooLowInCreateOrderRequest'
          }})};

          return cbk(null, {error: encodeMessage(error)});
        }

        if (Number(message.params.client_balance_sat) > Number(args.max_push_amount)) {
          const error = {
            error: makeErrorMessage({code: 1000, message: 'Option mismatch', data: {
            property: 'client_balance_sat',
            message: 'ClientBalanceTooHighInCreateOrderRequest'
          }})};

          return cbk(null, {error: encodeMessage(error)});
        }

        if (Number(message.params.channel_expiry_blocks) > Number(args.max_channel_expiry)) {
          const error = {
            error: makeErrorMessage({code: 1000, message: 'Option mismatch', data: {
            property: 'channel_expiry_blocks',
            message: 'ChannelExpiryBlocksTooHighInCreateOrderRequest'
          }})};

          return cbk(null, {error: encodeMessage(error)});
        }

        if (!message.params.refund_onchain_address) {
          const error = {
            error: makeErrorMessage({code: 1000, message: 'Option mismatch', data: {
            property: 'refund_onchain_address',
            message: 'RefundOnchainAddressMissingInCreateOrderRequest'
          }})};

          return cbk(null, {error: encodeMessage(error)});
        }

        return sendMessageToPeer({
          lnd: args.lnd,
          message,
          id: args.id,
        },
        cbk);
      }],
    },
    returnResult({reject, resolve, of: 'sendMessage'}, cbk));
  });
}

function makeErrorMessage({code, data, message, id}) {
  return encodeMessage(stringify({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      data,
    }
  }));
}