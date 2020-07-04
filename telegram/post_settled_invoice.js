const asyncAuto = require('async/auto');
const {getChannels} = require('ln-service');
const {getNode} = require('ln-service');
const {getPayment} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {subscribeToPastPayment} = require('ln-service');
const {verifyBytesSignature} = require('ln-service');

const {getNodeAlias} = require('./../peers');
const sendMessage = require('./send_message');

const bufFromHex = hex => Buffer.from(hex, 'hex');
const dateType = '34349343';
const earnEmoji = '💰';
const fromKeyType = '34349339';
const messageType = '34349334';
const rebalanceEmoji = '☯️';
const signatureType = '34349337';

/** Post settled invoices

  {
    from: <Invoice From Node String>
    id: <Connected User Id Number>
    invoice: {
      description: <Invoice Description String>
      id: <Invoice Preimage Hash Hex String>
      is_confirmed: <Invoice is Settled Bool>
      received: <Received Tokens Number>
    }
    key: <Telegram API Key String>
    lnd: <Authenticated LND gRPC API Object>
    payments: [{
      [confirmed_at]: <Payment Settled At ISO 8601 Date String>
      created_at: <Payment Held Since ISO 860 Date String>
      created_height: <Payment Held Since Block Height Number>
      in_channel: <Incoming Payment Through Channel Id String>
      is_canceled: <Payment is Canceled Bool>
      is_confirmed: <Payment is Confirmed Bool>
      is_held: <Payment is Held Bool>
      messages: [{
        type: <Message Type Number String>
        value: <Raw Value Hex String>
      }]
      mtokens: <Incoming Payment Millitokens String>
      [pending_index]: <Pending Payment Channel HTLC Index Number>
      tokens: <Payment Tokens Number>
      [total_mtokens]: <Total Payment Millitokens String>
    }]
    request: <Request Function>
  }

  @returns via cbk or Promise
*/
module.exports = ({from, id, invoice, key, lnd, request}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!from) {
          return cbk([400, 'ExpectedFromNameToPostSettledInvoice']);
        }

        if (!id) {
          return cbk([400, 'ExpectedUserIdNumberToPostSettledInvoice']);
        }

        if (!invoice) {
          return cbk([400, 'ExpectedInvoiceToPostSettledInvoice']);
        }

        if (!key) {
          return cbk([400, 'ExpectedTelegramApiKeyToPostSettledInvoice']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndObjectToPostSettledInvoice']);
        }

        if (!request) {
          return cbk([400, 'ExpectedRequestFunctionToPostSettledInvoice']);
        }

        return cbk();
      },

      // Find associated payment
      getPayment: ['validate', async ({}, cbk) => {
        // Exit early when the invoice has yet to be confirmed
        if (!invoice.is_confirmed) {
          return;
        }

        try {
          return await getPayment({lnd, id: invoice.id});
        } catch (err) {
          // Ignore errors, it is expected that there is no payment found
          return;
        }
      }],

      // Message
      message: ['getPayment', async ({getPayment}, cbk) => {
        if (!invoice.is_confirmed || !!getPayment) {
          return;
        }

        if (!invoice.payments.length) {
          return;
        }

        const [{messages}] = invoice.payments;

        const messageRecord = messages.find(n => n.type === messageType);

        if (!messageRecord) {
          return;
        }

        const message = bufFromHex(messageRecord.value).toString();

        const date = messages.find(n => n.type === dateType);
        const from = messages.find(n => n.type === fromKeyType);
        const signature = messages.find(n => n.type === signatureType);

        if (!from || !signature || !date) {
          return {message};
        }

        const preimage = Buffer.concat([
          bufFromHex(from.value),
          bufFromHex((await getWalletInfo({lnd})).public_key),
          bufFromHex(date.value),
          bufFromHex(messageRecord.value),
        ]);

        try {
          const validity = await verifyBytesSignature({
            lnd,
            preimage: preimage.toString('hex'),
            public_key: from.value,
            signature: signature.value,
          });

          if (!validity.is_valid) {
            throw new Error('ExpectedValidFromPublicKeySignature');
          }
        } catch (err) {
          return {message};
        }

        try {
          const node = await getNode({lnd, public_key: from.value});

          return {message, from: `${node.alias} ${from.value}`};
        } catch (err) {
          return {message, from: from.value};
        }
      }],

      // Details for message
      details: ['getPayment', 'message', ({getPayment, message}, cbk) => {
        // Exit early when the invoice has yet to be confirmed
        if (!invoice.is_confirmed) {
          return cbk();
        }

        const {description} = invoice;
        const {received} = invoice;

        const quotedDescription = !description ? '' : `for “${description}”`;

        const receiveLine = `Received ${received} ${quotedDescription}`;

        if (!getPayment && !message) {
          return cbk(null, receiveLine);
        }

        if (!getPayment && !!message) {
          const sender = `\nSender message: “${message.message}”`;

          const replyTo = !message.from ? '' : `\nFrom: ${message.from}`;

          return cbk(null, `${receiveLine}${sender}${replyTo}`);
        }

        const sub = subscribeToPastPayment({lnd, id: invoice.id});

        sub.on('confirmed', async payment => {
          sub.removeAllListeners();

          const [firstHop] = payment.hops;
          const paidFee = `Paid fee: ${payment.fee}`;
          const [inPayment] = invoice.payments;

          const outNode = await getNodeAlias({lnd, id: firstHop.public_key});

          const withNode = `with ${outNode.alias || outNode.id}`;

          const increase = `Increased inbound liquidity ${withNode}`;

          const rebalance = `${increase} by ${received}. ${paidFee}`;

          // Exit early when there is no payment to be found
          if (!inPayment) {
            return cbk(null, rebalance);
          }

          // Figure out who the channel is with
          const {channels} = await getChannels({lnd});

          const inChannel = channels.find(n => n.id === inPayment.in_channel);

          // Exit early if there is no channel with this peer
          if (!inChannel) {
            return cbk(null, rebalance);
          }

          const inNode = await getNodeAlias({
            lnd,
            id: inChannel.partner_public_key,
          });

          const decrease = `Decreased inbound on ${inNode.alias || inNode.id}`;

          return cbk(null, `${rebalance}. ${decrease}`);
        });

        sub.on('error', err => cbk());

        return;
      }],

      // Post invoice
      post: ['details', 'getPayment', ({details, getPayment}, cbk) => {
        // Exit early when there is nothing to post
        if (!details) {
          return cbk();
        }

        const emoji = !getPayment ? earnEmoji : rebalanceEmoji;

        const text = `${emoji} ${from}\n${details}`;

        return sendMessage({id, key, request, text}, cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
