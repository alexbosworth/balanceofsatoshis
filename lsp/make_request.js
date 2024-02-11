const {randomBytes} = require('crypto');

const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');
const {sendMessageToPeer} = require('ln-service');
const {subscribeToPeerMessages} = require('ln-service');

const {typeForMessaging} = require('./lsps1_protocol');
const {versionJsonRpc} = require('./lsps1_protocol');

const decodeMessage = n => JSON.parse(Buffer.from(n, 'hex').toString());
const encodeMessage = n => Buffer.from(JSON.stringify(n)).toString('hex');
const makeId = () => randomBytes(32).toString('hex');

/** Make a LSPS request

  {
    lnd: <Authenticated LND API Object>
    method: <Method Name String>
    [params]: <Parameters Object>
    service: <Service Identity Public Key Hex String>
    [timeout]: <Peer Response Timeout Milliseconds Number>
  }

  @returns via cbk or Promise
  {
    response: <Response Object>
  }
*/
module.exports = ({lnd, method, params, service, timeout}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedLndToMakeLspsRequest']);
        }

        if (!method) {
          return cbk([400, 'ExpectedMethodNameToMakeLspsRequest']);
        }

        if (!service) {
          return cbk([400, 'ExpectedServiceIdentityKeyToMakeLspsRequest']);
        }

        return cbk();
      },

      // Generate an id for the request
      id: ['validate', ({}, cbk) => cbk(null, makeId())],

      // Encode the request message
      message: ['id', ({id}, cbk) => {
        return cbk(null, encodeMessage({
          id,
          method,
          jsonrpc: versionJsonRpc,
          params: params || {},
        }));
      }],

      // Make the request to the peer
      request: ['id', 'message', ({id, message}, cbk) => {
        // Listen to incoming peer messages
        const sub = subscribeToPeerMessages({lnd});

        // Stop waiting for a response if things have gone on too long
        const timer = (() => {
          return !timeout ? null : setTimeout(() => {
            sub.removeAllListeners();

            return cbk([0, 'LspsServiceRequestTimeout']);
          },
          timeout);
        })();

        // Request resulted in an error
        const errored = err => {
          // Stop listening for more responses
          sub.removeAllListeners();

          // Stop the timeout timer
          clearTimeout(timer);

          return cbk(err);
        };

        // An error on the subscription
        sub.on('error', err => {
          return errored([503, 'ServiceRequestResponseListenerFailed', {err}]);
        });

        // Wait for a message on the request id
        sub.on('message_received', received => {
          // Exit early on messages from other nodes
          if (received.public_key !== service) {
            return;
          }

          // Exit early when the message type is not LSPS1
          if (received.type !== typeForMessaging) {
            return;
          }

          // Make sure that the message is valid JSON
          try {
            decodeMessage(received.message);
          } catch (err) {
            return errored([503, 'UnexpectedInvalidLspsResponse', {err}]);
          }

          const decoded = decodeMessage(received.message);

          // Exit early when this is a response for a different request
          if (decoded.id !== id) {
            return;
          }

          // Exit early when there is an error response
          if (!!decoded.error) {
            return errored([503, 'UnexpectedLspsErr', {error: decoded.error}]);
          }

          // Make sure that the JSON RPC is valid
          if (decoded.jsonrpc !== versionJsonRpc) {
            return errored([503, 'UnexpectedJsonRpcVersionFromLspsService']);
          }

          // Make sure that there is a result
          if (!decoded.result) {
            return errored([503, 'UnexpectedEmptyResponseFromLspsService']);
          }

          // Stop the timeout timer
          clearTimeout(timer);

          // Remove listener for response
          sub.removeAllListeners();

          return cbk(null, {response: decoded.result});
        });

        // Send the peer request
        return sendMessageToPeer({
          lnd,
          message,
          public_key: service,
          type: typeForMessaging,
        },
        err => {
          // Exit early when the message failed to send
          if (!!err) {
            return errored(err);
          }

          // Wait for the response in the subscription or the timeout
          return;
        });
      }],
    },
    returnResult({reject, resolve, of: 'request'}, cbk));
  });
};
