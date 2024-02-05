const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');
const {randomBytes} = require('crypto');
const {createHash} = require('crypto');
const {getChainFeeRate} = require('ln-service');
const {createChainAddress} = require('ln-service');
const {createHodlInvoice} = require('ln-service');
const {subscribeToInvoice} = require('ln-service');
const {settleHodlInvoice} = require('ln-service');
const {openChannel} = require('ln-service');
const {cancelHodlInvoice} = require('ln-service');
const {sendToChainAddress} = require('ln-service');
const {getHeight} = require('ln-service');
const {sendMessageToPeer} = require('ln-service');
const {subscribeToChainAddress} = require('ln-service');

const {requests} = require('./requests.json');
const {responses} = require('./responses.json');
const {constants} = require('./constants.json');

const decodeMessage = n => Buffer.from(n, 'hex').toString();
const encodeMessage = n => Buffer.from(JSON.stringify(n)).toString('hex');
const {parse} = JSON;
const {stringify} = JSON;
const makeOrderId = () => randomBytes(32).toString('hex');
const isNumber = n => !isNaN(n);
const sumOf = (a, b) => a + b;
const currentDate = () => new Date().toISOString();
const orderExpiryMs = 1000 * 60 * 60;
const onchainExpiryMs = 1000 * 60 * 60 * 24;
const channelExpiryMs = 1000 * 60 * 60 * 24 * 90;
const expiryDate = (n) => new Date(Date.now() + n).toISOString();
const randomSecret = () => randomBytes(32);
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
const refundTargetConfs = 6;


module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguements
      validate: cbk => {
        if (args.fee_rate === undefined || !isNumber(args.fee_rate)) {
          return cbk([400, 'ExpectedFeeRateToSendOrderMessage']);
        }

        if (!args.max_capacity) {
          return cbk([400, 'ExpectedMaxCapacityToSendOrderMessage']);
        }

        if (!args.min_capacity) {
          return cbk([400, 'ExpectedMinCapacityToSendOrderMessage']);
        }

        if (!args.min_onchain_payment_size) {
          return cbk([400, 'ExpectedMinOnchainPaymentSizeToSendOrderMessage']);
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

        if (!args.orders) {
          return cbk([400, 'ExpectedOrdersMapToSendOrderMessage']);
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

      // Validate the message
      getMessage: ['validate', ({}, cbk) => {
        const message = parse(decodeMessage(args.message));

        console.log('order message', message);

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

          return cbk(null, error);
        }

        if (!message.params.lsp_balance_sat || !isNumber(message.params.lsp_balance_sat)) {
          const error = {
            error: makeErrorMessage({code: -32606, message: 'Invalid params', data: {
            property: 'lsp_balance_sat',
            message: 'MissingLspBalanceInCreateOrderRequest'
          }})};

          return cbk(null, error);
        }

        if (!message.params.client_balance_sat || !isNumber(message.params.client_balance_sat)) {
          const error = {
            error: makeErrorMessage({code: -32606, message: 'Invalid params', data: {
            property: 'client_balance_sat',
            message: 'MissingClientBalanceInCreateOrderRequest'
          }})};

          return cbk(null, error);
        }

        if (!message.params.confirms_within_blocks || !isNumber(message.params.confirms_within_blocks)) {
          const error = {
            error: makeErrorMessage({code: -32606, message: 'Invalid params', data: {
            property: 'confirms_within_blocks',
            message: 'MissingConfirmsWithinBlocksInCreateOrderRequest'
          }})};

          return cbk(null, error);
        }

        if (!message.params.channel_expiry_blocks || !isNumber(message.params.channel_expiry_blocks)) {
          const error = {
            error: makeErrorMessage({code: -32606, message: 'Invalid params', data: {
            property: 'channel_expiry_blocks',
            message: 'MissingChannelExpiryBlocksInCreateOrderRequest'
          }})};

          return cbk(null, error);
        }

        if (!message.params.refund_onchain_address) {
          const error = {
            error: makeErrorMessage({code: -32606, message: 'Invalid params', data: {
            property: 'refund_onchain_address',
            message: 'MissingRefundOnchainAddressInCreateOrderRequest'
          }})};

          return cbk(null, error);
        }

        if (message.params.announce_channel === undefined) {
          const error = {
            error: makeErrorMessage({code: -32606, message: 'Invalid params', data: {
            property: 'announce_channel',
            message: 'MissingAnnounceChannelInCreateOrderRequest'
          }})};

          return cbk(null, error);
        }

        if (sumOf(Number(message.params.lsp_balance_sat), Number(message.params.client_balance_sat)) > Number(args.max_capacity)) {
          const error = {
            error: makeErrorMessage({code: 1000, message: 'Option mismatch', data: {
            property: 'lsp_balance_sat',
            message: 'OrderExceedingTotalCapacityInCreateOrderRequest'
          }})};

          return cbk(null, error);
        }

        if (sumOf(Number(message.params.lsp_balance_sat), Number(message.params.client_balance_sat)) < Number(args.min_capacity)) {
          const error = {
            error: makeErrorMessage({code: 1000, message: 'Option mismatch', data: {
            property: 'lsp_balance_sat',
            message: 'OrderBelowMinCapacityInCreateOrderRequest'
          }})};

          return cbk(null, error);
        }

        if (Number(message.params.client_balance_sat) > Number(constants.maxPushAmount)) {
          const error = {
            error: makeErrorMessage({code: 1000, message: 'Option mismatch', data: {
            property: 'client_balance_sat',
            message: 'ClientBalanceTooHighInCreateOrderRequest'
          }})};

          return cbk(null, error);
        }

        if (Number(message.params.channel_expiry_blocks) > Number(constants.channelExpiryBlocks)) {
          const error = {
            error: makeErrorMessage({code: 1000, message: 'Option mismatch', data: {
            property: 'channel_expiry_blocks',
            message: 'ChannelExpiryBlocksTooHighInCreateOrderRequest'
          }})};

          return cbk(null, error);
        }

        if (!message.params.refund_onchain_address) {
          const error = {
            error: makeErrorMessage({code: 1000, message: 'Option mismatch', data: {
            property: 'refund_onchain_address',
            message: 'RefundOnchainAddressMissingInCreateOrderRequest'
          }})};

          return cbk(null, error);
        }

        return cbk(null, {message});
      }],

      // Send error message
      sendErrorMessage: ['getMessage', ({getMessage}, cbk) => {
        if (!getMessage || !getMessage.error) {
          return cbk();
        }

        console.log('error message', getMessage.error);

        return sendMessageToPeer({
          lnd: args.lnd,
          message: encodeMessage(getMessage.error),
          public_key: args.pubkey,
          type: args.type,
        },
        cbk);
      }],

      getChainHeight: ['getMessage', ({getMessage}, cbk) => {
        if (!getMessage || !getMessage.message) {
          return cbk();
        }

        return getHeight({lnd: args.lnd}, cbk);
      }],

      // Get chain fees
      getChainFees: ['getMessage', ({getMessage}, cbk) => {
        // Exit early when there is no message
        if (!getMessage || !getMessage.message) {
          return cbk();
        }

        const blocks = getMessage.message.params.confirms_within_blocks;

        return getChainFeeRate({confirmation_target: Number(blocks), lnd: args.lnd}, cbk);
      }],

      // Calculate fees
      getFees: ['getChainFees', 'getMessage', ({getChainFees, getMessage}, cbk) => {
        // Exit early when there is no message
        if (!getMessage || !getMessage.message) {
          return cbk();
        }

        const rate = getChainFees.tokens_per_vbyte;
        const {message} = getMessage;

        // Aprox for 2 inputs and 2 outputs
        const vbytes = 300;

        // Fees per quarter
        const fees = (args.fee_rate / 1e6) * Number(message.params.lsp_balance_sat);

        // Total fees with opening and closing costs
        const total = fees + (rate * vbytes * 2);

        return cbk(null, {fees: total});
      }],

      // Send order message
      makeOrder: ['getFees', 'getMessage', async ({getFees, getMessage}) => {
        // Exit early when there is no message
        if (!getMessage || !getMessage.message) {
          return;
        }

        try {
          const orderResponse = responses.lsps1CreateOrderResponse;
          const {message} = getMessage;
          const {fees} = getFees;
          const orderId = makeOrderId();
          const expiresAt = expiryDate(orderExpiryMs);
          orderResponse.result.order_id = orderId;
          orderResponse.result.lsp_balance_sat = message.params.lsp_balance_sat;
          orderResponse.result.client_balance_sat = constants.maxPushAmount;
          orderResponse.result.confirms_within_blocks = message.params.confirms_within_blocks;
          orderResponse.result.channel_expiry_blocks = constants.channelExpiryBlocks;
          orderResponse.result.created_at = currentDate();
          orderResponse.result.expires_at = expiresAt;
          orderResponse.result.announce_channel = message.params.announce_channel;
          orderResponse.result.order_state = constants.orderStates.created;
          orderResponse.result.payment.state = constants.paymentStates.expectPayment;
          orderResponse.result.payment.fee_total_sat = String(fees);
  
          // Same as fees because push amounts are not supported
          orderResponse.result.payment.order_total_sat = String(fees);

          const secret = randomSecret();
          const invoiceId = sha256(secret);
  
          const {request, id} = await createHodlInvoice({expires_at: expiresAt, id: invoiceId, lnd: args.lnd, tokens: fees});
          const {address} = await createChainAddress({lnd: args.lnd, is_unused: false});
  
          orderResponse.result.payment.lightning_invoice = request;
          orderResponse.result.payment.onchain_address = address;
          orderResponse.result.payment.min_onchain_payment_confirmations = constants.minOnchainConfs;
          orderResponse.result.payment.onchain_payment = null;
          orderResponse.result.channel = null;
  
          await sendMessageToPeer({
            lnd: args.lnd,
            message: encodeMessage(orderResponse),
            public_key: args.pubkey,
            type: args.type,
          });

          // Store the order
          args.orders.set(orderId, JSON.stringify(orderResponse));

          return {address, id, orderId, secret: secret.toString('hex')};
        } catch (err) {
          // Ignore errors
          return;
        }
      }],

      // Make subscriptions ahead to clear together later
      makeSubscriptions: [
        'getChainHeight',
        'getMessage',
        'makeOrder',
        ({getChainHeight, getMessage, makeOrder}, cbk) => 
      {
        // Exit early when there is no message
        if (!getMessage || !getMessage.message) {
            return cbk();
          }

        const {address, id} = makeOrder;
        const height = getChainHeight.current_block_height;


        const invoiceSub = subscribeToInvoice({id, lnd: args.lnd});
        const onchainSub = subscribeToChainAddress({
          bech32_address: address, 
          lnd: args.lnd, 
          min_confirmations: constants.minOnchainConfs, 
          min_height: height,
        });

        return cbk(null, {invoiceSub, onchainSub});
      }],

      // Subscribe to invoice
      subscribeToPaymentRequest: [
        'getChainFees', 
        'getMessage', 
        'makeOrder',
        'makeSubscriptions',
        ({getChainFees, getMessage, makeOrder, makeSubscriptions}, cbk) => 
      {
        // Exit early when there is no message
        if (!getMessage || !getMessage.message) {
          return cbk();
        }

        const {id, orderId, secret} = makeOrder;
        const {invoiceSub, onchainSub} = makeSubscriptions;

        const timeout = setTimeout(() => {
          invoiceSub.removeAllListeners();

          return cbk([503, 'TimedOutWaitingForLightningPayment']);
        },
        orderExpiryMs);

        invoiceSub.on('invoice_updated', async invoice => {
          try {
            if (!invoice.is_held) {
              return;
            }

            clearTimeout(timeout);
            invoiceSub.removeAllListeners();
            onchainSub.removeAllListeners();

            // Update payment state to hold
            const order = args.orders.get(orderId);
            const parsedOrder = parse(order);

            console.log('order status initial', parsedOrder);

            parsedOrder.result.payment.state = constants.paymentStates.hold;
            args.orders.set(orderId, JSON.stringify(parsedOrder));

            console.log('order status before channel opened', parsedOrder);

            // Attempt to open channel
            const channel = await openChannel({
              lnd: args.lnd,
              partner_public_key: args.pubkey,
              local_tokens: parsedOrder.result.lsp_balance_sat,
              fee_rate: getChainFees.tokens_per_vbyte,
              description: `Open channel with ${args.pubkey} for order ${orderId}`,
              is_private: parsedOrder.result.announce_channel
            });

            // Update the order with the channel
            parsedOrder.result.channel = {
              funding_outpoint: `${channel.transaction_id}:${channel.transaction_vout}`,
              funded_at: currentDate(),
              expires_at: expiryDate(channelExpiryMs),
            };

            args.orders.set(orderId, JSON.stringify(parsedOrder));

            console.log('order status after channel opened', parsedOrder);
  
            // Use the secret to claim the funds
            await settleHodlInvoice({secret, lnd: args.lnd});
            
            // Update the order state
            parsedOrder.result.order_state = constants.orderStates.completed;
            parsedOrder.result.payment.state = constants.paymentStates.paid;
            args.orders.set(orderId, JSON.stringify(parsedOrder));

            console.log('order status finally', parsedOrder);
          } catch (err) {
            clearTimeout(timeout);
            invoiceSub.removeAllListeners();
            onchainSub.removeAllListeners();
            // Cancel invoice on error
            await cancelHodlInvoice({lnd: args.lnd, id});

            // Update the order state to failed
            const order = args.orders.get(orderId);
            const parsedOrder = parse(order);
            parsedOrder.result.order_state = constants.orderStates.failed;
            parsedOrder.result.payment.state = constants.paymentStates.refunded;
            args.orders.set(orderId, JSON.stringify(parsedOrder));

            console.log('order status finally after failing', parsedOrder);
            args.logger.error({err});
          }
        });

        invoiceSub.on('error', () => {
          clearTimeout(timeout);
          invoiceSub.removeAllListeners();
        });
      }],

      // Subscribe to onchain payment
      subscribeToOnchainPayment: [
        'getChainFees',
        'getChainHeight',
        'getMessage',
        'makeOrder',
        'makeSubscriptions',
        ({getChainFees, getMessage, makeOrder, makeSubscriptions}, cbk) => 
      {
        // Exit early when there is an error
        if (!getMessage || !getMessage.message) {
          return cbk();
        }

        const {orderId} = makeOrder;
        const {message} = getMessage;
        const {invoiceSub, onchainSub} = makeSubscriptions;

        const timeout = setTimeout(() => {
          onchainSub.removeAllListeners();

          return cbk([503, 'TimedOutWaitingForOnchainPayment']);
        },
        onchainExpiryMs);

        onchainSub.on('confirmation', async n => {
          try {
            console.log('onchain payment', n);
            clearTimeout(timeout);
            invoiceSub.removeAllListeners();
            onchainSub.removeAllListeners();

            // Update payment state to paid
            const order = args.orders.get(orderId);
            const parsedOrder = parse(order);
            parsedOrder.result.payment.state = constants.paymentStates.paid;
            args.orders.set(orderId, JSON.stringify(parsedOrder));

            console.log('order status before channel opened for onchain', parsedOrder);

            // Attempt to open channel
            const channel = await openChannel({
              lnd: args.lnd,
              partner_public_key: args.pubkey,
              local_tokens: parsedOrder.result.lsp_balance_sat,
              fee_rate: getChainFees.tokens_per_vbyte,
              description: `Open channel with ${args.pubkey} for order ${orderId}`,
              is_private: parsedOrder.result.announce_channel
            });

            // Update the order with the channel
            parsedOrder.result.channel = {
              funding_outpoint: `${channel.transaction_id}:${channel.transaction_vout}`,
              funded_at: currentDate(),
              expires_at: expiryDate(channelExpiryMs),
            };

            // Mark the order as completed
            parsedOrder.result.order_state = constants.orderStates.completed;

            args.orders.set(orderId, JSON.stringify(parsedOrder));

            console.log('order status after channel opened for onchain', parsedOrder);

          } catch (err) {
            clearTimeout(timeout);
            invoiceSub.removeAllListeners();
            onchainSub.removeAllListeners();
            // Update the order state to failed
            const order = args.orders.get(orderId);
            const parsedOrder = parse(order);
            parsedOrder.result.order_state = constants.orderStates.failed;
            args.orders.set(orderId, JSON.stringify(parsedOrder));

            // Refund the onchain payment
            await sendToChainAddress({
              address: message.params.refund_onchain_address,
              lnd: args.lnd,
              target_confirmations: refundTargetConfs,
              tokens: Number(message.params.lsp_balance_sat),
            });

            parsedOrder.result.payment.state = constants.paymentStates.refunded;
            args.orders.set(orderId, JSON.stringify(parsedOrder));

            args.logger.error({err});
          }
        });

        onchainSub.on('error', () => {
          clearTimeout(timeout);
          onchainSub.removeAllListeners();
        });
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
}

function makeErrorMessage({code, data, message, id}) {
  return stringify({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      data,
    }
  });
}