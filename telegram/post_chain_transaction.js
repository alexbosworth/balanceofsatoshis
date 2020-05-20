const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const sendMessage = require('./send_message');

const emoji = '⛓';
const tokAsBig = tokens => (tokens / 1e8).toFixed(8);

/** Post settled payment

  {
    from: <From Node String>
    id: <Connected User Id Number>
    key: <Telegram API Key String>
    lnd: <Authenticated LND API Object>
    request: <Request Function>
    transaction: [{
      [chain_fee]: <Paid Transaction Fee Tokens Number>
      [received]: <Received Tokens Number>
      related_channels: [{
        action: <Channel Action String>
        [balance]: <Channel Balance Tokens Number>
        [capacity]: <Channel Capacity Value Number>
        [channel]: <Channel Standard Format Id String>
        [close_tx]: <Channel Closing Transaction Id Hex String>
        [open_tx]: <Channel Opening Transaction id Hex String>
        [timelock]: <Channel Funds Timelocked Until Height Number>
        with: <Channel Peer Public Key Hex String>
      }]
      [sent]: <Sent Tokens Number>
      [sent_to]: [<Sent to Address String>]
      [tx]: <Transaction Id Hex String>
    }]
  }

  @returns via cbk or Promise
*/
module.exports = ({from, id, key, lnd, request, transaction}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!from) {
          return cbk([400, 'ExpectedFromNodeFromToPostChainTransaction']);
        }

        if (!id) {
          return cbk([400, 'ExpectedConnectedUserIdToPostChainTransaction']);
        }

        if (!key) {
          return cbk([400, 'ExpectedApiKeyToPostChainTransaction']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndToPostChainTransaction']);
        }

        if (!request) {
          return cbk([400, 'ExpectedRequestToPostChainTransaction']);
        }

        if (!transaction) {
          return cbk([400, 'ExpectedTransactionRecordToPostChainTransaction']);
        }

        return cbk();
      },

      // Details of message
      details: ['validate', ({}, cbk) => {
        const chainFee = transaction.chain_fee;

        const fee = !!chainFee ? `Paid ${tokAsBig(chainFee)} fee` : '';

        const related = transaction.related_channels.map(related => {
          const alias = related.node || String();

          switch (related.action) {
          case 'channel_closing':
            return `Closing channel with ${alias || related.with}`;

          case 'cooperatively_closed_channel':
            return `Cooperatively closed with ${alias || related.with}`;

          case 'force_closed_channel':
            return `Force closed channel with ${alias || related.with}`;

          case 'opened_channel':
            return `Opened channel with ${alias || related.with}`;

          case 'opening_channel':
            return `Opening channel with ${alias || related.with}`;

          case 'peer_force_closed_channel':
            return `${alias || related.with} force closed channel`;

          case 'peer_force_closing_channel':
            return `${alias || related.with} force closing channel`;

          default:
            return '';
          }
        });

        const relatedChannels = related.filter(n => !!n).join('. ');

        // Exit early when the transaction is receiving
        if (!!transaction.received) {
          const elements = [
            `Received ${tokAsBig(transaction.received)}`,
            fee,
            !!relatedChannels.length ? `Related: ${relatedChannels}` : '',
          ];

          return cbk(null, elements.filter(n => !!n).join('. '));
        }

        // Exit early when the the transaction is sending
        if (!!transaction.sent) {
          const sentTo = transaction.sent_to;

          const elements = [
            `Sent ${tokAsBig(transaction.received)}`,
            fee,
            !sentTo ? `Sent to ${sentTo.join(', ')}` : '',
            !!relatedChannels.length ? `Related: ${relatedChannels}` : '',
          ];

          return cbk(null, elements.filter(n => !!n).join('. '));
        }

        return cbk();
      }],

      // Post message
      post: ['details', ({details}, cbk) => {
        if (!details) {
          return cbk();
        }

        const text = `${emoji} ${from}\n${details}`;

        return sendMessage({id, key, request, text}, cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
