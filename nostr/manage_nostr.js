const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const adjustRelays = require('./adjust_relays');
const broadcastMessage = require('./broadcast_message');
const saveNostrKey = require('./save_nostr_key');

const {isArray} = Array;

module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isArray(args.add)) {
          return cbk([400, 'ExpectedArrayOfRelaysToAddToManageNostr']);
        }

        if (!args.fs) {
          return cbk([400, 'ExpectedFilesystemMethodsToManageNostr']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToManageNostr']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToManageNostr']);
        }

        if (!isArray(args.remove)) {
          return cbk([400, 'ExpectedArrayOfRelaysToRemoveToManageNostr']);
        }

        return cbk();
      },

      // Save the nostr private key
      saveNostrKey: ['validate', ({}, cbk) => {
        // Exit early if not saving a nostr key
        if (!args.nostr_key) {
          return cbk();
        }

        return saveNostrKey({
          fs: args.fs,
          key: args.nostr_key,
          lnd: args.lnd,
          logger: args.logger,
        },
        cbk);
      }],

      // Add or remove relays
      manageRelays: ['validate', ({}, cbk) => {
        // Exit early if not adjusting relays
        if (!args.add.length && !args.remove.length) {
          return cbk();
        }

        return adjustRelays({
          add: args.add,
          fs: args.fs,
          logger: args.logger,
          remove: args.remove,
        },
        cbk)
      }],

      broadcast: [
        'manageRelays', 
        'saveNostrKey', 
        'validate', 
        ({}, cbk) => 
      {
        // Exit early if there is no event to broadcast
        if (!args.group_open_event) {
          return cbk();
        }

        return broadcastMessage({
          fs: args.fs,
          group_open_event: args.group_open_event,
          lnd: args.lnd,
          logger: args.logger,
        },
        cbk);
      }]
    },
    returnResult({reject, resolve}, cbk));
  });
};
