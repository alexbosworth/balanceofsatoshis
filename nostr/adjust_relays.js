const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const {homePath} = require('../storage');

const defaultRelaysFile = {relays: []};
const {isArray} = Array;
const isWebsocket = (n) => /^wss?:\/\/(([^:]+)(:(\d+))?)/.test(n);
const {parse} = JSON;
const relayFilePath = () => homePath({file: 'nostr_relays.json'}).path;
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

      // Get the current relays from the relay file
      getRelays: ['registerHomeDir', ({}, cbk) => {
        return args.fs.getFile(relayFilePath(), (err, res) => {
          // Potentially there's no relays file yet
          if (!!err || !res) {
            return cbk(null, Buffer.from(stringify(defaultRelaysFile)));
          }

          try {
            parse(res.toString());
          } catch (err) {
            return cbk([400, 'ExpectedValidJsonRelaysFileToAdjustRelays', {err}]);
          }

          const file = parse(res.toString());

          if (!isArray(file.relays)) {
            return cbk([400, 'ExpectedRelaysArrayInTagsFileToAdjustrelays']);
          }

          return cbk(null, res.toString());
        });
      }],

      // Adjust relays
      adjustRelays: ['getRelays', ({getRelays}, cbk) => {
        const file = parse(getRelays);

        args.add.forEach(n => {
          const findRelay = file.relays.find(relay => relay === n);

          if (!findRelay) {
            file.relays.push(n);
          }
        });

        args.remove.forEach(n => {
          const findRelay = file.relays.find(relay => relay === n);

          if (!!findRelay) {
            file.relays = file.relays.filter(relay => relay !== n)
          }
        });

        return args.fs.writeFile(relayFilePath(), stringify(file), err => {
          if (!!err) {
            return cbk([503, 'UnexpectedErrorSavingRelayFileUpdate', {err}]);
          }

          args.logger.info({relays: file.relays});

          return cbk();
        });
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
