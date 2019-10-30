const asyncAuto = require('async/auto');
const {decodePaymentRequest} = require('ln-service');
const {getPayment} = require('ln-service');
const {payViaRoutes} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {subscribeToProbe} = require('ln-service');

const checkAccess = require('./check_access');
const decodeCommand = require('./decode_command');
const interaction = require('./interaction');
const sendMessage = require('./send_message');

const {ceil} = Math;
const defaultMaxTokensMultiplier = 1.01;
const {isArray} = Array;
const isNumber = n => !isNaN(n);
const {min} = Math;
const mtokensToTokens = tokens => Number(BigInt(tokens) / BigInt(1e3));
const pathTimeoutMs = 1000 * 30;
const pathfindTimeoutMs = 1000 * 60;

/** Initiate payment

  Syntax of command:

  /pay <node_number> <payment_request> <maximum fee tokens>

  {
    budget: <Max Spendable Tokens Limit Number>
    from: <Command From User Id Number>
    id: <Connected User Id Number>
    key: <Telegram API Key String>
    reply: <Reply Function>
    request: <Request Function>
    text: <Original Command Text String>
  }

  @returns via cbk
  {
    tokens: <Spent Tokens Number>
  }
*/
module.exports = ({budget, from, id, key, nodes, reply, request, text}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!budget) {
          return cbk([400, 'ExpectedTokensLimitForPayCommand']);
        }

        if (!from) {
          return cbk([400, 'ExpectedCommandFromUserIdNumberToPayCommand']);
        }

        if (!id) {
          return cbk([400, 'ExpectedConnectedIdForPayCommand']);
        }

        if (!key) {
          return cbk([400, 'ExpectedTelegramApiKeyForPayCommand']);
        }

        if (!isArray(nodes) || !nodes.length) {
          return cbk([400, 'ExpectedNodesForPayCommand']);
        }

        if (!request) {
          return cbk([400, 'ExpectedRequestFunctionForPayCommand']);
        }

        if (!text) {
          return cbk([400, 'ExpectedOriginalCommandTextForPayCommand']);
        }

        return cbk();
      },

      // Check access
      checkAccess: ['validate', ({}, cbk) => {
        return checkAccess({from, id, reply}, cbk);
      }],

      // Decode the command
      decodeCommand: ['validate', ({}, cbk) => {
        const help = {
          select_node_text: interaction.select_node_for_payment,
          syntax_example_text: interaction.pay_syntax,
        };

        return decodeCommand({help, id, key, nodes, request, text}, cbk);
      }],

      // Decode payment request
      decodeRequest: ['decodeCommand', ({decodeCommand}, cbk) => {
        const {lnd} = decodeCommand;
        const [request] = decodeCommand.params;

        return decodePaymentRequest({lnd, request}, (err, res) => {
          if (!!err) {
            cbk([400, 'FailedToDecodePaymentRequest']);
          }

          return cbk(null, {
            cltv_delta: res.cltv_delta,
            destination: res.destination,
            id: res.id,
            routes: res.routes,
            tokens: res.tokens,
          });
        });
      }],

      // Check the amount and set max tokens budget
      maxTokens: [
        'decodeCommand',
        'decodeRequest',
        ({decodeCommand, decodeRequest}, cbk) =>
      {
        const multiplier = defaultMaxTokensMultiplier;
        const [, paymentLimit] = decodeCommand.params;
        const {tokens} = decodeRequest;

        const paymentBudget = paymentLimit || ceil(tokens * multiplier);

        if (!isNumber(paymentBudget)) {
          return cbk([400, 'ExpectedNumericValueForPaymentLimit']);
        }

        if (tokens > Number(paymentBudget)) {
          return cbk([400, 'PaymentRequestExceedsAmountAllowedForPayment']);
        }

        if (tokens > budget) {
          return cbk([400, 'PaymentRequestExceedsPaymentLimit']);
        }

        return cbk(null, min(Number(paymentBudget), budget));
      }],

      // Status update
      postStatus: ['decodeRequest', 'maxTokens', ({decodeRequest}, cbk) => {
        return sendMessage({
          id,
          key,
          request,
          text: `🤖 Paying ${decodeRequest.tokens}...`,
        },
        cbk);
      }],

      // Execute a probe
      probe: [
        'decodeCommand',
        'decodeRequest',
        'maxTokens',
        'postStatus',
        ({decodeCommand, decodeRequest, maxTokens}, cbk) =>
      {
        let probeTimeout;

        const sub = subscribeToProbe({
          cltv_delta: decodeRequest.cltv_delta,
          destination: decodeRequest.destination,
          lnd: decodeCommand.lnd,
          path_timeout_ms: pathTimeoutMs,
          routes: decodeRequest.routes,
          tokens: decodeRequest.tokens,
        });

        const finished = (err, res) => {
          clearTimeout(probeTimeout);

          sub.removeAllListeners();

          // Switch and return the final result

          return cbk(err, res);
        };

        probeTimeout = setTimeout(
          () => finished([503, 'FindPathTimeout']),
          pathfindTimeoutMs
        );

        // Finish without success
        sub.once('end', () => finished([503, 'FailedToFindPathToPay']));

        // Finish with error
        sub.on('error', err => finished(err));

        // Log failures encountered while trying to find a route
        sub.on('routing_failure', async fail => {
          const at = `at ${fail.channel || fail.public_key}`;
          const source = fail.route.hops[fail.index - [fail].length];

          let fromName = !source ? null : source.public_key;

          try {
            const node = await getNode({
              lnd,
              is_omitting_channels: true,
              public_key: source.public_key,
            });

            fromName = node.alias;
          } catch (err) {}

          const from = !source ? '' : `from ${fromName}`;

          const text = `${fail.reason} ${at} ${from}`;

          return sendMessage({id, key, request, text}, err => {});
        });

        // Finish with successful probe
        sub.on('probe_success', ({route}) => {
          const {tokens} = route;

          // Finish with error when there is a fee limit exceeded
          if (tokens > maxTokens) {
            return finished([400, 'PaymentLimitLow', {needed_limit: tokens}]);
          }

          return finished(null, {route});
        });

        return;
      }],

      // Pay the request
      pay: [
        'decodeCommand',
        'decodeRequest',
        'probe',
        ({decodeCommand, decodeRequest, probe}, cbk) =>
      {
        return payViaRoutes({
          id: decodeRequest.id,
          lnd: decodeCommand.lnd,
          routes: [probe.route],
        },
        err => {
          // Ignore payment errors
          return cbk();
        });
      }],

      // Get the status of the payment
      getPayment: [
        'decodeCommand',
        'decodeRequest',
        'pay',
        ({decodeCommand, decodeRequest}, cbk) =>
      {
        return getPayment({
          id: decodeRequest.id,
          lnd: decodeCommand.lnd,
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          // Exit with error when the payment was rejected
          if (!!res.failed && !!res.is_invalid_payment) {
            return cbk([503, 'PaymentRejectedByDestination']);
          }

          // Exit with error when the payment failed for reason
          if (!!res.is_failed) {
            return cbk([503, 'PaymentFailedToSend']);
          }

          // Exit with error when the payment is in limbo
          if (!!res.is_pending) {
            const text = interaction.payment_is_stuck;

            sendMessage({id, key, request, text}, err => {});

            return cbk([503, 'PaymentStuckInPendingState']);
          }

          // Exit with error when the payment is in a weird state
          if (!res.payment || !res.payment.mtokens) {
            return cbk([503, 'UnexpectedStateOfPayment']);
          }

          return cbk(null, {
            fee: mtokensToTokens(res.payment.fee_mtokens),
            hops: res.payment.hops,
            tokens: mtokensToTokens(res.payment.mtokens),
          });
        });
      }],

      // Post success
      success: [
        'decodeRequest',
        'getPayment',
        ({decodeRequest, getPayment}, cbk) =>
      {
        return sendMessage({
          id,
          key,
          request,
          text: `Sent ${decodeRequest.tokens}! Fee: ${getPayment.fee}.`
        },
        err => {
          // Ignore errors
          return cbk();
        });
      }],
    },
    (err, res) => {
      if (!!isArray(err)) {
        const [code, message, context] = err;

        // Setting text means that the payment definitively failed
        let text;

        // Set the text if there is a known failure and rollback tokens is ok
        switch (message) {
        case 'ExpectedNumericValueForPaymentLimit':
          text = `Missing payment limit amount\n${interaction.pay_syntax}`;
          break;

        case 'FailedToDecodePaymentRequest':
          text = 'Could not decode payment request, is it pasted correctly?';
          break;

        case 'FailedToFindPathToPay':
          text = 'No route to payment destination, create a new channel?';
          break;

        case 'FindPathTimeout':
          text = 'Could not find route to destination. Try again?';
          break;

        case 'PaymentFailedToSend':
          text = 'Payment failed to send. Try again?';
          break;

        case 'PaymentLimitLow':
          text = `Higher payment limit needed: ${context.needed_limit}`;
          break;

        case 'PaymentRejectedByDestination':
          text = 'The receiver rejected the payment. Try again?';
          break;

        case 'PaymentRequestExceedsAmountAllowedForPayment':
          text = 'Payment amount higher than limit specified.';
          break;

        case 'PaymentRequestExceedsPaymentLimit':
          text = 'Payment amount higher than budget. Try a lower amount?';
          break;

        case 'UnknownNodeToUseForCommand':
          text = `Specify node to pay with...`;
          break;

        default:
          break;
        }

        // Report unanticipated errors
        if (!text) {
          return returnResult({reject, resolve, of: 'getPayment'}, cbk)(err);
        }

        sendMessage({id, key, request, text}, err => {});

        return returnResult({reject, resolve, of: 'getPayment'}, cbk)(null, {
          getPayment: {tokens: 0},
        });
      }

      return returnResult({reject, resolve, of: 'getPayment'}, cbk)(err, res);
    });
  });
};
