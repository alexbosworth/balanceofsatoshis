const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const {homePath} = require('../storage');

const defaultRelaysFile = {relays: []};
const {isArray} = Array;
const isWebsocket = (n) => /^wss?:\/\/(([^:]+)(:(\d+))?)/.test(n);
const {parse} = JSON;
const relayFilePath = () => homePath({file: 'nostr.json'}).path;
const stringify = obj => JSON.stringify(obj, null, 2);

/** Adjust relays

  {
    [add]: [<Relay Uri To Add String>]
    fs: {
      getFile: <Read File Contents Function> (path, cbk) => {}
      makeDirectory: <Make Directory Function> (path, cbk) => {}
      writeFile: <Write File Contents Function> (path, contents, cbk) => {}
    }
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
          return cbk([400, 'ExpectedArrayOfRelaysToAddToAdjustRelays']);
        }

        if (!args.fs) {
          return cbk([400, 'ExpectedFilesystemMethodsToAdjustRelays']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToAdjustRelays']);
        }

        if (!isArray(args.remove)) {
          return cbk([400, 'ExpectedArrayOfRelaysToRemoveToAdjustRelays']);
        }

        if (!args.add.length && !args.remove.length) {
          return cbk([400, 'ExpectedEitherAddOrRemoveRelayListToAdjustRelays']);
        }

        if (!!args.add.filter(n => !isWebsocket(n)).length) {
          return cbk([400, 'RelaysToAddMustBeValidWebSocketUris']);
        }

        if (!!args.remove.filter(n => !isWebsocket(n)).length) {
          return cbk([400, 'RelaysToRemoveMustBeValidWebSocketUris']);
        }

        return cbk();
      },

      // Register the home directory
      registerHomeDir: ['validate', ({}, cbk) => {
        return args.fs.makeDirectory(homePath({}).path, err => {
          // Ignore errors, the directory may already be there
          return cbk();
        });
      }],

      // Read file and adjust
      adjustRelays: ['registerHomeDir', ({}, cbk) => {
        const node = args.node || '';

        return args.fs.getFile(relayFilePath(), (err, res) => {
          // Exit if there is no relays file
          if (!!err || !res) {
            return cbk([400, 'ExpectedValidJsonNostrFileToAdjustRelays']);
          }

          try {
            const file = parse(res.toString());

            if (!file.nostr || !isArray(file.nostr) || !file.nostr.length) {
              return cbk([400, 'ExpectedAtLeastOneNostrKeyInNostrFileToAdjustRelays']);
            }

            const findNode = file.nostr.find(n => n.node === node);

            if (!findNode) {
              return cbk([400, 'ExpectedSavedNostrKeyInNostrFileToAdjustRelays']);
            }

            // Adjust the relays file
            args.add.forEach(n => {
              const findRelay = findNode.relays.find(relay => relay === n);

              if (!findRelay) {
                findNode.relays.push(n);
              }
            });

            args.remove.forEach(n => {
              const findRelay = findNode.relays.find(relay => relay === n);

              if (!!findRelay) {
                findNode.relays = findNode.relays.filter(relay => relay !== n)
              }
            });

            return cbk(null, {file, relays: findNode.relays});
          } catch (err) {
            return cbk([400, 'ExpectedValidJsonRelaysFileToAdjustRelays', {err}]);
          }
        });
      }],

      // Adjust relays
      writeFile: ['adjustRelays', ({adjustRelays}, cbk) => {
        return args.fs.writeFile(relayFilePath(), stringify(adjustRelays.file), err => {
          if (!!err) {
            return cbk([503, 'UnexpectedErrorSavingRelayFileUpdate', {err}]);
          }

          args.logger.info({relays_adjusted: adjustRelays.relays});

          return cbk();
        });
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
