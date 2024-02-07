const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');
const {openChannel} = require('ln-service');
const {settleHodlInvoice} = require('ln-service');

const {constants} = require('./constants.json');

const channelExpiryMs = 1000 * 60 * 60 * 24 * 90;
const currentDate = () => new Date().toISOString();
const expiryDate = (n) => new Date(Date.now() + n).toISOString();
const {parse} = JSON;
const {stringify} = JSON;
let order;

module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguements
      validate: cbk => {        
        if (!args.chain_fees) {
          return cbk([400, 'ExpectedChainFeesToSettlePaymentAndOpenChannels']);
        }
        
        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToSettlePaymentAndOpenChannels']);
        }
        
        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToSettlePaymentAndOpenChannels']);
        }
        
        if (!args.order) {
          return cbk([400, 'ExpectedOrderToSettlePaymentAndOpenChannels']);
        }
        
        if (!args.order_id) {
          return cbk([400, 'ExpectedOrderIdToSettlePaymentAndOpenChannels']);
        }
        
        if (!args.orders) {
          return cbk([400, 'ExpectedOrdersMapToSettlePaymentAndOpenChannels']);
        }
        
        if (!args.pubkey) {
          return cbk([400, 'ExpectedPubkeyToSettlePaymentAndOpenChannels']);
        }

        if (!args.secret) {
          return cbk([400, 'ExpectedSecretToSettlePaymentAndOpenChannels']);
        }
        
        try {
          parse(args.order);
        } catch (err) {
          return cbk([400, 'ExpectedValidOrderToSettlePaymentAndOpenChannels']);
        }
        
        return cbk();
      },
      
      // Open channel
      openChannel: ['validate', ({}, cbk) => {
        order = parse(args.order);
        args.logger.info({initial_status: order.result});
        
        // Set payment status to hold 
        order.result.payment.state = constants.paymentStates.hold;
        
        args.orders.set(args.order_id, stringify(order));
        
        args.logger.info({before_channel_opened_status: order.result});
        
        // Attempt to open channel
        return openChannel({
          lnd: args.lnd,
          partner_public_key: args.pubkey,
          local_tokens: order.result.lsp_balance_sat,
          fee_rate: args.chain_fees,
          description: `Open channel with ${args.pubkey} for order ${args.order_id}`,
          is_private: !order.result.announce_channel
        },
        cbk);
      }],
      
      updateOrder: ['openChannel', ({openChannel}, cbk) => {
        // Update the order with the channel
        order.result.channel = {
          funding_outpoint: `${openChannel.transaction_id}:${openChannel.transaction_vout}`,
          funded_at: currentDate(),
          expires_at: expiryDate(channelExpiryMs),
        };
        
        args.orders.set(args.order_id, stringify(order));
        
        args.logger.info({after_channel_opened_status: order.result});
        
        return cbk();
      }],
      
      // Settle payment
      settlePayment: ['updateOrder', ({}, cbk) => {
        settleHodlInvoice({
          lnd: args.lnd,
          secret: args.secret,
        }, (err, res) => {
          if (!!err) {
            return cbk([503, 'UnexpectedErrorSettlingPayment', {err}]);
          }
          
          // Update the order state
          order.result.order_state = constants.orderStates.completed;
          order.result.payment.state = constants.paymentStates.paid;
          args.orders.set(args.order_id, stringify(order));
          
          args.logger.info({final_status: order.result});

          return cbk();
        })
      }]
    },
    returnResult({reject, resolve, of: 'settlePayment'}, cbk));
  });
}