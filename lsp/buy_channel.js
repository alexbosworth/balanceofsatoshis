const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const {parsePaymentRequest} = require('ln-service');
const {payViaPaymentRequest} = require('ln-service');

const {constants} = require('./constants.json');

module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguements
      validate: cbk => {
        if (args.announce_channel === undefined) {
          return cbk([400, 'ExpectedAnnounceChannelToBuyChannel']);
        }

        if (!args.ask) {
          return cbk([400, 'ExpectedAskFunctionToBuyChannel']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndBuyChannel']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToBuyChannel']);
        }

        if (!args.message) {
          return cbk([400, 'ExpectedMessageToBuyChannel']);
        }

        if (!args.priority) {
          return cbk([400, 'ExpectedPriorityToBuyChannel']);
        }

        if (!args.pubkey) {
          return cbk([400, 'ExpectedPubkeyToBuyChannel']);
        }

        if (!args.tokens) {
          return cbk([400, 'ExpectedTokensToBuyChannel']);
        }

        if (!args.type) {
          return cbk([400, 'ExpectedTypeToBuyChannel']);
        }

        return cbk();
      },

      // Request info
      validateMessage: ['validate', ({}, cbk) => {
        const {message} = args;

        if (!message.order_id) {
          return cbk([400, 'ExpectedOrderIdToBuyChannel']);
        }

        if (Number(message.lsp_balance_sat) !== args.tokens) {
          return cbk([400, 'ExpectedTokensToMatchLspBalance']);
        }

        if (message.client_balance_sat !== '' && message.client_balance_sat !== '0') {
          return cbk([400, 'ExpectedZeroClientBalanceToBuyChannel']);
        }

        if (message.confirms_within_blocks !== args.priority) {
          return cbk([400, 'ExpectedPriorityToMatchConfirmsWithinBlocks']);
        }

        if (message.channel_expiry_blocks !== constants.channelExpiryBlocks) {
          return cbk([400, 'ExpectedMatchingChannelExpiryBlocksToBuyChannel']);
        }

        if (message.announce_channel !== args.announce_channel) {
          return cbk([400, 'ExpectedMatchingAnnounceChannelToBuyChannel']);
        }

        if (message.order_state !== constants.orderStates.created) {
          return cbk([400, 'ExpectedOrderStateToBeCreatedToBuyChannel']);
        }

        if (!message.payment) {
          return cbk([400, 'ExpectedPaymentDetailsToBuyChannel']);
        }

        const {payment} = message;

        // Fee total and order total sats should match because we don't support push amounts
        if (payment.fee_total_sat !== payment.order_total_sat) {
          return cbk([400, 'ExpectedMatchingFeeAndOrderTotalSatToBuyChannel']);
        }

        if (payment.state !== constants.paymentStates.expectPayment) {
          return cbk([400, 'ExpectedExpectPaymentStateToBuyChannel']);
        }

        if (!payment.fee_total_sat) {
          return cbk([400, 'ExpectedFeeTotalSatToBuyChannel']);
        }

        if (!payment.order_total_sat) {
          return cbk([400, 'ExpectedOrderTotalSatToBuyChannel']);
        }

        try {
          const res = parsePaymentRequest({request: payment.lightning_invoice});

          if (res.tokens !== Number(payment.order_total_sat)) {
            return cbk([400, 'ExpectedMatchingTokensInPaymentRequest']);
          }
        } catch (err) {
          return cbk([400, 'ExpectedValidPaymentRequestToBuyChannel', {err}]);
        }

        return cbk();
      }],

      // Ask to buy the channel
      ask: ['validateMessage', ({}, cbk) => {
        args.logger.info({
          order_id: args.message.order_id,
          channel_size: args.message.lsp_balance_sat,
          confirms_within_blocks: args.message.confirms_within_blocks,
          expiry_blocks: args.message.channel_expiry_blocks,
          is_private: !args.announce_channel,
          fees: args.message.payment.order_total_sat,
        });

        return args.ask({
          default: true,
          message: 'Do you want to buy the channel?',
          name: 'confirm',
          type: 'confirm',
        },
        ({confirm}) => {
          if (!confirm) {
            return cbk([400, 'BuyCancelled']);
          }

          return cbk(null, confirm);
        });
      }],

      // Pay lightning invoice
      payLightning: ['ask', ({ask}, cbk) => {
        if (!ask) {
          return cbk();
        }

        const {payment} = args.message;

        return payViaPaymentRequest({
          lnd: args.lnd,
          request: payment.lightning_invoice,
        },
        cbk)
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
}