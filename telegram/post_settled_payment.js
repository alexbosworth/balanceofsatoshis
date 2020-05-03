const asyncAuto = require('async/auto');
const {getNode} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const sendMessage = require('./send_message');

const emoji = '⚡️';
const tokAsBig = tokens => (tokens / 1e8).toFixed(8);

/** Post settled payment

  {
    from: <Payment From Node String>
    id: <Connected User Id Number>
    key: <Telegram API Key String>
    lnd: <Authenticated LND API Object>
    payment: [{
      destination: <Payment Destination Public Key Hex String>
      id: <Payment Hash Hex String>
      request: <Payment BOLT11 Request String>
      safe_fee: <Safe Paid Fee Tokens Number>
      safe_tokens: <Safe Paid Tokens Number>
    }]
    request: <Request Function>
  }

  @returns via cbk or Promise
*/
module.exports = ({from, id, key, lnd, payment, request}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!from) {
          return cbk([400, 'ExpectedPaymentFromNameStringToPostPayment']);
        }

        if (!id) {
          return cbk([400, 'ExpectedUserIdToPostSettledPayment']);
        }

        if (!key) {
          return cbk([400, 'ExpectedTelegramApiKeyToPostSettledPayment']);
        }

        if (!payment) {
          return cbk([400, 'ExpectedPaymentToPostSettledPayment']);
        }

        if (!request) {
          return cbk([400, 'ExpectedRequestFunctionToPostSettledPayment']);
        }

        return cbk();
      },

      // Find the node that was paid to
      getNode: ['validate', ({}, cbk) => {
        return getNode({
          lnd,
          is_omitting_channels: true,
          public_key: payment.destination,
        },
        (err, res) => {
          // Ignore errors
          if (!!err) {
            return cbk(null, {});
          }

          return cbk(null, res);
        });
      }],

      // Create the message details
      details: ['getNode', ({getNode}, cbk) => {
        const destination = getNode.alias || payment.destination;
        const routingFee = `. Paid routing fee: ${tokAsBig(payment.safe_fee)}`;
        const sent = tokAsBig(payment.safe_tokens);

        const fee = !payment.safe_fee ? '' : routingFee;

        const details = `Sent ${sent} to ${destination}${fee}`;

        return cbk(null, details);
      }],

      // Post message
      post: ['details', ({details}, cbk) => {
        const text = `${emoji} ${from}\n${details}`;

        return sendMessage({id, key, request, text}, cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
