const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const respondToKeySendPing = require('./respond_to_key_send_ping');

const hexAsString = hex => Buffer.from(hex, 'hex').toString();
const {isArray} = Array;
const typePing = '8470534167946609795';

/** Respond to a keysend request

  {
    id: <Received Payment Invoice Id Hex String>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    messages: [{
      type: <Message Type Number String>
      value: <Raw Value Hex String>
    }]
    received: <Received Tokens Rounded Down Number>
  }

  @returns via cbk or Promise
*/
module.exports = ({id, lnd, logger, messages, received}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!id) {
          return cbk([400, 'ExpectedIdToRespondToKeySendRequest']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndToRespondToKeySendRequest']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedLoggerToRespondToKeySendRequest']);
        }

        if (!isArray(messages)) {
          return cbk([400, 'ExpectedMessagesArrayToRespondToKeySendRequest']);
        }

        if (received === undefined) {
          return cbk([400, 'ExpectedReceivedTokensRespondToKeySendRequest']);
        }

        return cbk();
      },

      // Check to see if this is a ping
      ping: ['validate', ({}, cbk) => {
        const ping = messages.find(({type}) => type === typePing);

        // Exit early when this is not a ping request
        if (!ping) {
          return cbk();
        }

        return respondToKeySendPing({
          id,
          lnd,
          logger,
          received,
          request: hexAsString(ping.value),
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
