const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const adjustRelays = require('./adjust_relays');
const buildEvent = require('./build_event');
const saveNostrKey = require('./save_nostr_key');

const {isArray} = Array;

/** Manage nostr functions

  {
    [add]: [<Relay Uri To Add String>]
    fs: {
      getFile: <Read File Contents Function> (path, cbk) => {}
      makeDirectory: <Make Directory Function> (path, cbk) => {}
      writeFile: <Write File Contents Function> (path, contents, cbk) => {}
    }
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    node: <Saved Node Name String>
    [remove]: [<Relay Uri To String>]
  }

  @returns via cbk or Promise
*/
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

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToManageNostr']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToManageNostr']);
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
          node: args.node,
        },
        cbk);
      }],

      // Add or remove relays
      manageRelays: ['saveNostrKey', 'validate', ({}, cbk) => {
        // Exit early if not adjusting relays
        if (!args.add.length && !args.remove.length) {
          return cbk();
        }

        return adjustRelays({
          add: args.add,
          fs: args.fs,
          logger: args.logger,
          node: args.node,
          remove: args.remove,
        },
        cbk)
      }],

      // Build the nostr event
      buildNostrEvent: [
        'manageRelays', 
        'saveNostrKey', 
        'validate', 
        ({}, cbk) => 
      {
        // Exit early if there is no event to broadcast
        if (!args.message) {
          return cbk();
        }

        return buildEvent({
          fs: args.fs,
          message: args.message,
          lnd: args.lnd,
          logger: args.logger,
          node: args.node,
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
