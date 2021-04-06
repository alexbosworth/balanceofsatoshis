const {createHash} = require('crypto');

const asyncAuto = require('async/auto');
const {createInvoice} = require('ln-service');
const {getInvoice} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const respondToKeySendPing = require('./respond_to_key_send_ping');

const expires = () => new Date(1000 * 60 * 60 * 24 + Date.now()).toISOString();
const hashOf = preimage => createHash('sha256').update(preimage).digest();
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const {isArray} = Array;
const typePing = '8470534167946609795';

/** Respond to a keysend request

  {
    id: <Received Payment Invoice Id Hex String>
    lnd: <Server Authenticated LND API Object>
    logger: <Winston Logger Object>
    messages: [{
      type: <Message Type Number String>
      value: <Raw Value Hex String>
    }]
    pay: <Payer Authenticated LND API Object>
    received: <Received Tokens Rounded Down Number>
  }

  @returns via cbk or Promise
*/
module.exports = ({id, lnd, logger, messages, pay, received}, cbk) => {
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

        if (!pay) {
          return cbk([400, 'ExpectedPayerLndToRespondToKeySendRequest']);
        }

        if (received === undefined) {
          return cbk([400, 'ExpectedReceivedTokensRespondToKeySendRequest']);
        }

        return cbk();
      },

      // Derive a locking id from the keysend request
      lockId: ['validate', ({}, cbk) => {
        return cbk(null, hashOf(hexAsBuffer(id)));
      }],

      // Look for a pending lock invoice
      hasLock: ['lockId', ({lockId}, cbk) => {
        return getInvoice({lnd, id: lockId}, err => cbk(null, !err));
      }],

      // Create a locking invoice to safeguard against double response
      createLock: ['hasLock', ({hasLock}, cbk) => {
        if (!!hasLock) {
          return cbk([409, 'LockExistsForKeySendRequest', {id}]);
        }

        return createInvoice({lnd, expires_at: expires()}, cbk);
      }],

      // Check to see if this is a ping
      ping: ['createLock', ({}, cbk) => {
        const ping = messages.find(({type}) => type === typePing);

        // Exit early when this is not a ping request
        if (!ping) {
          return cbk();
        }

        return respondToKeySendPing({
          id,
          lnd,
          logger,
          pay,
          received,
          request: hexAsBuffer(ping.value).toString(),
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
