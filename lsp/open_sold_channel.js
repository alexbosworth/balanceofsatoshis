const asyncAuto = require('async/auto');
const asyncReflect = require('async/reflect');
const {cancelHodlInvoice} = require('ln-service');
const {getInvoice} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {openChannel} = require('ln-service');
const {settleHodlInvoice} = require('ln-service');
const {acceptsChannelOpen} = require('ln-sync');

const {orderStateFailed} = require('./lsps1_protocol');
const {orderStateCompleted} = require('./lsps1_protocol');
const {paymentStateHeldPayment} = require('./lsps1_protocol');
const {paymentStatePaid} = require('./lsps1_protocol');
const {paymentStateRefunded} = require('./lsps1_protocol');

const asOutpoint = utxo => `${utxo.transaction_id}:${utxo.transaction_vout}`;
const channelExpiryMs = 1000 * 60 * 60 * 24 * 90;
const expiryDate = ms => new Date(Date.now() + ms).toISOString();
const {parse} = JSON;
const updateOrder = (orders, o, id) => orders.set(id, JSON.stringify(o));

/** Attempt to open a sold channel

  {
    chain_fee: <Chain Fee Rate Per VByte For Channel Open Number>
    invoice_id: <Channel Open Invoice Payment Hash Id Hex String>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    open_to: <Open To Node With Identity Public Key Hex String>
    order_id: <Channel Sale Order Id String>
    orders: <Open Orders Map Object>
    secret: <Invoice Secret Preimage Hex String>
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.chain_fee) {
          return cbk([400, 'ExpectedChainFeesToOpenSoldChannel']);
        }

        if (!args.invoice_id) {
          return cbk([400, 'ExpectedInvoiceIdToOpenSoldChannel']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToOpenSoldChannel']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToOpenSoldChannel']);
        }

        if (!args.open_to) {
          return cbk([400, 'ExpectedIdentityPublicKeyToOpenSoldChannelTo']);
        }

        if (!args.order_id) {
          return cbk([400, 'ExpectedOrderIdToOpenSoldChannel']);
        }

        if (!args.orders) {
          return cbk([400, 'ExpectedOrdersMapToOpenSoldChannel']);
        }

        if (!args.secret) {
          return cbk([400, 'ExpectedSecretToOpenSoldChannel']);
        }

        return cbk();
      },

      // Get the order
      order: ['validate', ({}, cbk) => {
        if (!args.orders.get(args.order_id)) {
          return cbk([400, 'ExpectedExistingOrderToOpenSoldChannel']);
        }

        return cbk(null, parse(args.orders.get(args.order_id)));
      }],

      // Check if a channel open would be accepted
      acceptsOpen: ['order', asyncReflect(({order}, cbk) => {
        args.logger.info({initial_status: order.result});

        // Set payment status to hold 
        order.result.payment.state = paymentStateHeldPayment;

        updateOrder(args.orders, order, args.order_id);

        return acceptsChannelOpen({
          capacity: order.result.lsp_balance_sat,
          is_private: !order.result.announce_channel,
          lnd: args.lnd,
          partner_public_key: args.open_to,
        },
        cbk);
      })],

      // Attempt to open channel
      openChannel: [
        'acceptsOpen',
        'order',
        asyncReflect(({acceptsOpen, order}, cbk) =>
      {
        // Exit early when the channel open is not accepted
        if (!!acceptsOpen.error) {
          return cbk(acceptsOpen.error);
        }

        return openChannel({
          description: `Sold channel open for invoice ${args.invoice_id}`,
          chain_fee_tokens_per_vbyte: args.chain_fee,
          is_private: !order.result.announce_channel,
          lnd: args.lnd,
          local_tokens: order.result.lsp_balance_sat,
          partner_public_key: args.open_to,
        },
        cbk);
      })],

      // Update the order with the channel information
      addChannel: ['openChannel', 'order', ({openChannel, order}, cbk) => {
        // Exit early when the open attempt was not successful
        if (!!openChannel.error) {
          return cbk();
        }

        order.result.channel = {
          expires_at: expiryDate(channelExpiryMs),
          funded_at: new Date().toISOString(),
          funding_outpoint: asOutpoint(openChannel.value),
        };

        updateOrder(args.orders, order, args.order_id);

        args.logger.info({
          channel_opening: order.result.channel,
          is_private_chan: !order.result.announce_channel || undefined,
          resolve_invoice: args.invoice_id,
          reveal_preimage: args.secret,
        });

        return cbk();
      }],

      // Prevent the invoice from being paid
      cancel: ['openChannel', ({openChannel}, cbk) => {
        // Exit early when the open was successful
        if (!openChannel.error) {
          return cbk();
        }

        args.logger.error({err: openChannel.error});

        // Cancel back the held payment since the channel open failed
        return cancelHodlInvoice({lnd: args.lnd, id: args.invoice_id}, cbk);
      }],

      // Update the order to failed state
      failOrder: [
        'cancel',
        'openChannel',
        'order',
        ({cancel, openChannel, order}, cbk) =>
      {
        // Exit early when the open was successful
        if (!openChannel.error) {
          return cbk();
        }

        order.result.order_state = orderStateFailed;
        order.result.payment.state = paymentStateRefunded;

        updateOrder(args.orders, order, args.order_id);

        args.logger.info({order_failed: args.order_id});

        return cbk();
      }],

      // Now that the delivery of the channel has been made, take the funds
      settle: ['addChannel', 'openChannel', ({openChannel}, cbk) => {
        // Exit early when the open attempt was not successful
        if (!!openChannel.error) {
          return cbk();
        }

        return settleHodlInvoice({lnd: args.lnd, secret: args.secret}, cbk);
      }],

      // Finalize the payment state in the order records
      updateAsPaid: [
        'openChannel',
        'order',
        'settle',
        ({openChannel, order}, cbk) =>
      {
        // Exit early when the open attempt was not successful
        if (!!openChannel.error) {
          return cbk();
        }

        order.result.order_state = orderStateCompleted;
        order.result.payment.state = paymentStatePaid;

        updateOrder(args.orders, order, args.order_id);

        return cbk();
      }],

      // Get the updated invoice to see how much was received
      getUpdated: ['openChannel', 'updateAsPaid', ({openChannel}, cbk) => {
        // Exit early when the open attempt was not successful
        if (!!openChannel.error) {
          return cbk();
        }

        return getInvoice({id: args.invoice_id, lnd: args.lnd}, cbk);
      }],

      // Notify of received payment
      received: ['getUpdated', ({getUpdated}, cbk) => {
        if (!getUpdated) {
          return cbk();
        }

        args.logger.info({
          order_complete: args.order_id,
          received_funds: getUpdated.received,
        });

        return cbk();
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
