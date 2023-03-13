const asyncAuto = require('async/auto');
const asyncEach = require('async/each');
const {returnResult} = require('asyncjs-util');
const WebSocket = require('ws');

const bufferAsString = buffer => buffer.toString();
const {isArray} = Array;
const {parse} = JSON;

/** Publish event to relays

  {
    event: <Nostr Event String>
    logger: <Winston Logger Object>
    relays: [<Relay Uri String>]
  }

  @returns via cbk or Promise
*/
module.exports = ({event, logger, relays}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!event) {
          return cbk([400, 'ExpectedEventToPublishToRelays']);
        }

        try {
          parse(event);
        } catch (err) {
          return cbk([400, 'ExpectedValidJsonEventToPublishToRelays']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedLoggerToPublishToRelays']);
        }

        if (!isArray(relays) || !relays.length) {
          return cbk([400, 'ExpectedArrayOfRelayUrisToPublishToRelays']);
        }

        return cbk();
      },

      // Publish event to relays
      publish: ['validate', ({}, cbk) => {
        return asyncEach(relays, (relay, cbk) => {
          const ws = new WebSocket(relay);

          ws.on('error', err => {
            logger.error({relay, error: err});
            ws.close();

            return cbk();
          });
  
          ws.on('open', () => {
            ws.send(event);
          });
  
          ws.on('message', function message(data) {
            logger.info({relay, is_ok: bufferAsString(data)});
            ws.close();

            return cbk();
          });
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
