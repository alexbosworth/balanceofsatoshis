const asyncAuto = require('async/auto');
const {createInvoice} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const checkAccess = require('./check_access');
const decodeCommand = require('./decode_command');
const interaction = require('./interaction');
const sendMessage = require('./send_message');

const expiry = () => new Date(Date.now() + 1000 * 60 * 60 * 3).toISOString();
const {isArray} = Array;
const isNumber = n => !isNaN(n);
const tinyKey = key => key.slice(0, 8);

/** Create invoice

  {
    from: <Command From User Id Number>
    id: <Connected Id Number>
    key: <Telegram API Key String>
    nodes: [{
      alias: <Alias String>
      lnd: <Authenticated LND gRPC API Object>
      public_key: <Public Key Hex String>
    }]
    reply: <Reply Function>
    request: <Request Function>
    text: <Message Text String>
  }

  @returns via cbk or Promise
*/
module.exports = ({from, id, key, nodes, reply, request, text}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!from) {
          return cbk([400, 'ExpectedFromUserIdToCreateInvoice']);
        }

        if (!id) {
          return cbk([400, 'ExpectedConnectedIdToCreateInvoice']);
        }

        if (!isArray(nodes) || !nodes.length) {
          return cbk([400, 'ExpectedArrayOfNodesToCreateInvoice']);
        }

        if (!reply) {
          return cbk([400, 'ExpectedReplyToCreateInvoice']);
        }

        if (!request) {
          return cbk([400, 'ExpectedRequestToCreateInvoice']);
        }

        if (!text) {
          return cbk([400, 'ExpectedCommandTextToCreateInvoice']);
        }

        return cbk();
      },

      // Check access
      checkAccess: ['validate', ({}, cbk) => {
        return checkAccess({from, id, reply}, cbk);
      }],

      // Decode command arguments
      decodeCommand: ['checkAccess', ({}, cbk) => {
        const help = {
          select_node_text: interaction.select_node_for_invoice,
          syntax_example_text: interaction.create_invoice_syntax,
        };

        return decodeCommand({help, id, key, nodes, request, text}, cbk);
      }],

      // Invoice details
      invoiceDetails: ['decodeCommand', ({decodeCommand}, cbk) => {
        const [amount, ...description] = decodeCommand.params;

        // Exit early when the amount is unknown
        if (!isNumber(amount)) {
          const syntax = interaction.create_invoice_syntax;

          const howMuch = `How much should the invoice be for?\n${syntax}`;

          return sendMessage({id, key, request, text: howMuch}, () => {
            return cbk([400, 'ExpectedAnAmountToCreateInvoice']);
          });
        }

        return cbk(null, {
          description: description.join(' '),
          lnd: decodeCommand.lnd,
          tokens: Number(amount),
        });
      }],

      // Status update
      postStatus: ['invoiceDetails', ({invoiceDetails}, cbk) => {
        return sendMessage({
          id,
          key,
          request,
          text: `🤖 Making invoice for ${invoiceDetails.tokens}...`,
        },
        cbk);
      }],

      // Create
      create: ['invoiceDetails', ({invoiceDetails}, cbk) => {
        const {description} = invoiceDetails;
        const {tokens} = invoiceDetails;

        return createInvoice({
          description,
          tokens,
          expires_at: expiry(),
          is_including_private_channels: true,
          lnd: invoiceDetails.lnd,
        },
        (err, res) => {
          // Exit early when there was an issue creating the invoice
          if (!!err) {
            const [, message] = err;

            return sendMessage({
              id,
              key,
              request,
              text: `⚠️ *Failed to create invoice: ${message}*`,
            },
            cbk);
          }

          return sendMessage({id, key, request, text: res.request}, cbk);
        });
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
