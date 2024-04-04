const {randomBytes} = require('crypto');

const asyncAuto = require('async/auto');
const {createHodlInvoice} = require('ln-service');
const {getChainFeeRate} = require('ln-service');
const {getNodeAlias} = require('ln-sync');
const {returnResult} = require('asyncjs-util');
const {sendMessageToPeer} = require('ln-service');
const {subscribeToInvoice} = require('ln-service');

const {assumedOpenTransactionVbytes} = require('./constants');
const {codeInvalidParameters} = require('./lsps1_protocol');
const {codeOptionMismatch} = require('./lsps1_protocol');
const {defaultLifetimeBlocks} = require('./constants');
const {errMessageInvalidParams} = require('./lsps1_protocol');
const {errMessageOptionMismatch} = require('./lsps1_protocol');
const makeErrorMessage = require('./make_error_message');
const openSoldChannel = require('./open_sold_channel');
const {orderStateCreated} = require('./lsps1_protocol');
const {paymentStateExpectedPayment} = require('./lsps1_protocol');
const {typeForMessaging} = require('./lsps1_protocol');
const {versionJsonRpc} = require('./lsps1_protocol');

const blocksAsMs = blocks => blocks * 10 * 60 * 1000;
const blocksPerYear = 144 * 365;
const capacityFee = (rate, capacity) => Math.floor(rate * capacity / 1e6 / 4);
const decodeMessage = n => Buffer.from(n, 'hex').toString();
const encodeMessage = n => Buffer.from(n, 'utf8').toString('hex');
const expiryDate = ms => new Date(Date.now() + ms).toISOString();
const {floor} = Math;
const isNumber = n => !!n && !isNaN(n);
const makeOrderId = () => randomBytes(16).toString('hex');
const maxMessageIdLength = 100;
const niceAlias = n => `${(n.alias || n.id).trim()} ${n.id}`;
const notNegative = n => Math.max(0, n);
const orderExpiryMs = 1000 * 60 * 60;
const {parse} = JSON;
const {stringify} = JSON;
const sumOf = arr => arr.reduce((sum, n) => sum + n, 0);
const tokensAsBigUnit = tokens => (tokens / 1e8).toFixed(8);

/** Create a new order invoice for a channel open attempt sale

  {
    fee_rate: <Capacity Fee Rate Per Year Parts Per Million Number>
    max_capacity: <Maximum Capacity Tokens Number>
    message: <Received Message String>
    min_capacity: <Minimum Capacity Tokens Number>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    orders: <Orders Map Object>
    to_peer: <Client Public Key Identity Hex String>
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (args.fee_rate === undefined || !isNumber(args.fee_rate)) {
          return cbk([400, 'ExpectedCapacityRateToProcessOpenChannelOrder']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToProcessOpenChannel']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToProcessOpenChannelOrder']);
        }

        if (!args.max_capacity) {
          return cbk([400, 'ExpectedMaxCapacityToProcessOpenChannelOrder']);
        }

        if (!args.min_capacity) {
          return cbk([400, 'ExpectedMinCapacityToProcessOpenChannelOrder']);
        }

        if (!args.message) {
          return cbk([400, 'ExpectedMessageToProcessOpenChannelOrder']);
        }

        try {
          parse(decodeMessage(args.message));
        } catch (e) {
          return cbk([400, 'ExpectedValidMessageToProcessOpenChannelOrder']);
        }

        if (!args.orders) {
          return cbk([400, 'ExpectedOrdersMapToProcessOpenChannelOrder']);
        }

        if (!args.to_peer) {
          return cbk([400, 'ExpectedPubkeyToProcessOpenChannelOrder']);
        }

        return cbk();
      },

      // Get the peer alias
      getAlias: ['validate', ({}, cbk) => {
        return getNodeAlias({id: args.to_peer, lnd: args.lnd}, cbk);
      }],

      // Parse the message
      message: ['validate', ({}, cbk) => {
        const message = parse(decodeMessage(args.message));

        // A response cannot be returned when there is no request id
        if (!message.id || message.id.length > maxMessageIdLength) {
          return cbk([400, 'ExpectedMessageIdToProcessOpenChannelOrder']);
        }

        const order = makeOrderId();

        return cbk(null, {order, id: message.id, params: message.params});
      }],

      // Validate the message
      getMessage: ['message', ({message}, cbk) => {
        // Params are needed for order information
        if (!message.params) {
          return cbk(null, {
            error: makeErrorMessage({
              code: codeInvalidParameters,
              data: {
                message: 'MissingParamsInCreateOrderRequest',
                property: 'params',
              },
              id: message.id,
              message: errMessageInvalidParams,
            }),
          });
        }

        if (!isNumber(message.params.lsp_balance_sat)) {
          return cbk(null, {
            error: makeErrorMessage({
              code: codeInvalidParameters,
              data: {
                message: 'MissingLspBalanceInCreateOrderRequest',
                property: 'lsp_balance_sat',
              },
              id: message.id,
              message: errMessageInvalidParams,
            }),
          });
        }

        if (!isNumber(message.params.client_balance_sat)) {
          return cbk(null, {
            error: makeErrorMessage({
              code: codeInvalidParameters,
              data: {
                message: 'MissingClientBalanceInCreateOrderRequest',
                property: 'client_balance_sat',
              },
              id: message.id,
              message: errMessageInvalidParams,
            }),
          });
        }

        if (!isNumber(message.params.confirms_within_blocks)) {
          return cbk(null, {
            error: makeErrorMessage({
              code: codeInvalidParameters,
              data: {
                message: 'MissingConfirmsWithinBlocksInCreateOrderRequest',
                property: 'confirms_within_blocks',
              },
              id: message.id,
              message: errMessageInvalidParams,
            }),
          });
        }

        if (!isNumber(message.params.channel_expiry_blocks)) {
          return cbk(null, {
            error: makeErrorMessage({
              code: codeInvalidParameters,
              data: {
                message: 'MissingChannelExpiryBlocksInCreateOrderRequest',
                property: 'channel_expiry_blocks',
              },
              id: message.id,
              message: errMessageInvalidParams,
            }),
          });
        }

        if (message.params.announce_channel === undefined) {
          return cbk(null, {
            error: makeErrorMessage({
              code: codeInvalidParameters,
              data: {
                message: 'MissingAnnounceChannelInCreateOrderRequest',
                property: 'announce_channel',
              },
              id: message.id,
              message: errMessageInvalidParams,
            }),
          });
        }

        const capacity = sumOf([
          Number(message.params.lsp_balance_sat),
          Number(message.params.client_balance_sat),
        ]);

        if (capacity > Number(args.max_capacity)) {
          return cbk(null, {
            error: makeErrorMessage({
              code: codeOptionMismatch,
              data: {
                message: 'OrderExceedingTotalCapacityInCreateOrderRequest',
                property: 'lsp_balance_sat',
              },
              id: message.id,
              message: errMessageOptionMismatch,
            }),
          });
        }

        if (capacity < Number(args.min_capacity)) {
          return cbk(null, {
            error: makeErrorMessage({
              code: codeOptionMismatch,
              data: {
                message: 'OrderBelowMinCapacityInCreateOrderRequest',
                property: 'lsp_balance_sat',
              },
              id: message.id,
              message: errMessageOptionMismatch,
            }),
          });
        }

        if (!!Number(message.params.client_balance_sat)) {
          return cbk(null, {
            error: makeErrorMessage({
              code: codeOptionMismatch,
              data: {
                message: 'ClientBalanceTooHighInCreateOrderRequest',
                property: 'client_balance_sat',
              },
              id: message.id,
              message: errMessageOptionMismatch,
            }),
          });
        }

        const minLifetimeBlocks = Number(message.params.channel_expiry_blocks);

        if (minLifetimeBlocks > Number(defaultLifetimeBlocks)) {
          return cbk(null, {
            error: makeErrorMessage({
              code: codeOptionMismatch,
              data: {
                message: 'ChannelExpiryBlocksTooHighInCreateOrderRequest',
                property: 'channel_expiry_blocks',
              },
              id: message.id,
              message: errMessageOptionMismatch,
            }),
          });
        }

        return cbk(null, {
          capacity,
          id: message.id,
          order: message.order,
          params: message.params,
        });
      }],

      // Send error message
      sendErrorMessage: ['getMessage', ({getMessage}, cbk) => {
        // Exit early when the order did not error
        if (!getMessage.error) {
          return cbk();
        }

        return sendMessageToPeer({
          lnd: args.lnd,
          message: encodeMessage(stringify(getMessage.error)),
          public_key: args.to_peer,
          type: typeForMessaging,
        },
        cbk);
      }],

      // Get chain fees
      getChainFees: ['getMessage', ({getMessage}, cbk) => {
        // Exit early when there was an error
        if (!!getMessage.error) {
          return cbk();
        }

        // Exit early when there are no message params to process
        if (!getMessage.params) {
          return cbk();
        }

        const blocks = getMessage.params.confirms_within_blocks;

        return getChainFeeRate({
          confirmation_target: Number(blocks),
          lnd: args.lnd,
        },
        cbk);
      }],

      // Calculate fees
      getFees: [
        'getChainFees',
        'getMessage',
        ({getChainFees, getMessage}, cbk) =>
      {
        // Exit early when there was an error
        if (!!getMessage.error) {
          return cbk();
        }

        const baseFee = notNegative(floor(args.base_fee));
        const isPrivate = !getMessage.params.announce_channel;
        const rate = getChainFees.tokens_per_vbyte;
        const time = getMessage.params.channel_expiry_blocks / blocksPerYear;

        const estimatedChainFee = floor(assumedOpenTransactionVbytes * rate);
        const privateRate = isPrivate ? args.private_fee_rate : Number();

        const ppmFees = floor(args.fee_rate) + floor(privateRate);

        const capacityFees = capacityFee(ppmFees, getMessage.capacity);

        const ppmTotalFee = floor(time * capacityFees);

        return cbk(null, {
          capacity: getMessage.capacity,
          fees: baseFee + notNegative(ppmTotalFee) + estimatedChainFee,
          order: getMessage.order,
        });
      }],

      // Make the invoice for this order
      makeInvoice: [
        'getAlias',
        'getFees',
        'getMessage',
        ({getAlias, getFees, getMessage}, cbk) =>
      {
        // Exit early when there was an error
        if (!getFees) {
          return cbk();
        }

        const capacity = tokensAsBigUnit(getFees.capacity);
        const minLifetimeBlocks = getMessage.params.channel_expiry_blocks;

        const expiry = expiryDate(blocksAsMs(minLifetimeBlocks));

        args.logger.info({
          capacity,
          expiry,
          quote: tokensAsBigUnit(getFees.fees),
          returning_quote_to: niceAlias(getAlias),
        });

        return createHodlInvoice({
          description: `Channel ${capacity} to ${expiry} (${getFees.order})`,
          expires_at: expiryDate(orderExpiryMs),
          lnd: args.lnd,
          tokens: getFees.fees,
        },
        cbk);
      }],

      // Wait for the invoice to be paid
      waitForPayment: [
        'makeInvoice',
        'message',
        ({makeInvoice, message}, cbk) =>
      {
        // Exit early when there was an error
        if (!makeInvoice) {
          return cbk();
        }

        const sub = subscribeToInvoice({id: makeInvoice.id, lnd: args.lnd});

        // Stop listening to the invoice after it expires
        const timeout = setTimeout(() => {
          sub.removeAllListeners();

          return cbk([408, 'TimedOutWaitingForOpenChannelLightningPayment']);
        },
        orderExpiryMs);

        // Wait for the payment to come in
        sub.on('invoice_updated', invoice => {
          // Only consider updates where the payment is being held
          if (!invoice.is_held) {
            return;
          }

          clearTimeout(timeout);

          sub.removeAllListeners();

          return cbk(null, {
            id: invoice.id,
            order: message.order,
            secret: makeInvoice.secret,
          });
        });

        // Exit with error when there is a subscription failure
        sub.on('error', err => {
          clearTimeout(timeout);

          sub.removeAllListeners();

          return cbk([503, 'SubscriptionToOpenChannelInvoiceFails', {err}]);
        });
      }],

      // Send order message
      makeOrder: ['makeInvoice', 'message', ({makeInvoice, message}, cbk) => {
        // Exit early when there was an error
        if (!makeInvoice) {
          return;
        }

        const response = stringify({
          id: message.id,
          jsonrpc: versionJsonRpc,
          result: {
            announce_channel: !!message.params.announce_channel,
            channel: null,
            channel_expiry_blocks: defaultLifetimeBlocks,
            client_balance_sat: Number().toString(),
            confirms_within_blocks: message.params.confirms_within_blocks,
            created_at: new Date().toISOString(),
            expires_at: expiryDate(orderExpiryMs),
            lsp_balance_sat: message.params.lsp_balance_sat,
            order_id: message.order,
            order_state: orderStateCreated,
            payment: {
              fee_total_sat: makeInvoice.tokens.toString(),
              lightning_invoice: makeInvoice.request,
              min_fee_for_0conf: null,
              min_onchain_payment_confirmations: null,
              onchain_address: null,
              onchain_payment: null,
              order_total_sat: makeInvoice.tokens.toString(),
              state: paymentStateExpectedPayment,
            },
            token: String(),
          },
        });

        // Store the order
        args.orders.set(message.order, response);

        // Tell the client about the order
        return sendMessageToPeer({
          lnd: args.lnd,
          message: encodeMessage(response),
          public_key: args.to_peer,
          type: typeForMessaging,
        },
        cbk);
      }],

      // Calculate open chain fees
      getOpenFeeRate: ['getMessage', 'waitForPayment', ({getMessage}, cbk) => {
        // Exit early when there are no message params to process
        if (!getMessage.params) {
          return cbk();
        }

        const blocks = getMessage.params.confirms_within_blocks;

        return getChainFeeRate({
          confirmation_target: Number(blocks),
          lnd: args.lnd,
        },
        cbk);
      }],

      // Open the channel
      open: [
        'getOpenFeeRate',
        'waitForPayment',
        ({getOpenFeeRate, waitForPayment}, cbk) =>
      {
        // Exit early when there was an error
        if (!waitForPayment || !waitForPayment.order) {
          return cbk();
        }

        return openSoldChannel({
          chain_fee: getOpenFeeRate.tokens_per_vbyte,
          invoice_id: waitForPayment.id,
          lnd: args.lnd,
          logger: args.logger,
          open_to: args.to_peer,
          order_id: waitForPayment.order,
          orders: args.orders,
          secret: waitForPayment.secret,
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
