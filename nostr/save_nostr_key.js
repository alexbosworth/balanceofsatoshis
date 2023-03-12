const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const {encryptToNode} = require('../encryption');
const {homePath} = require('../storage');

const defaultRelaysFile = {nostr: []};
const nostrKeyFilePath = () => homePath({file: 'nostr.json'}).path;
const {parse} = JSON;
const stringify = obj => JSON.stringify(obj, null, 2);


/** Save encrypted nostr private key

  {
    fs: {
      getFile: <Read File Contents Function> (path, cbk) => {}
      makeDirectory: <Make Directory Function> (path, cbk) => {}
      writeFile: <Write File Contents Function> (path, contents, cbk) => {}
    }
    key: <Nostr Private Key String>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    node: <Saved Node Name String>
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.fs) {
          return cbk([400, 'ExpectedFilesystemMethodsToSaveNostrKey']);
        }

        if (!args.key) {
          return cbk([400, 'ExpectedNostrPrivateKeyToSaveNostrKey']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToSaveNostrKey']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToSaveNostrKey']);
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

      // Encrypt the private key
      encryptKey: ['validate', ({}, cbk) => {
        return encryptToNode({
          lnd: args.lnd,
          message: args.key,
        },
        cbk)
      }],

      readFile: ['encryptKey', 'validate', ({encryptKey}, cbk) => {
        const node = args.node || "";
        
        return args.fs.getFile(nostrKeyFilePath(), (err, res) => {
          // Ignore errors, the file may not exist
          if (!!err || !res) {
            defaultRelaysFile.nostr.push({key: encryptKey.encrypted, node, relays: []});

            return cbk(null, {file: defaultRelaysFile});
          }

          try {
            const file = parse(res.toString());
            
            if (!file.nostr) {
              return cbk([503, 'ExpectedNostrKeyInNostrKeyFile']);
            }

            if (!file.nostr.length) {
              file.nostr.push({key: encryptKey.encrypted, node, relays: []});

              return cbk(null, {file: file});
            }

            const existing = file.nostr.find(n => n.node === node);

            if (!existing) {
              file.nostr.push({key: encryptKey.encrypted, node, relays: []});

              return cbk(null, {file: file});
            }

            existing.key = encryptKey.encrypted;

            return cbk(null, {file: file});
          } catch(err) {
            return cbk([503, 'FailedToParseNostrKeyFile', {err}]);
          }
        });
      }],

      // Save the encrypted nostr private key
      saveKey: [
        'encryptKey', 
        'readFile',
        'registerHomeDir', 
        ({readFile}, cbk) => {
          const {file} = readFile;

        return args.fs.writeFile(nostrKeyFilePath(), stringify(file), err => {
          if (!!err) {
            return cbk([503, 'FailedToSaveNostrKey', {err}]);
          }

          args.logger.info({'is_nostr_key_saved': true});
          
          return cbk();
        });
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
