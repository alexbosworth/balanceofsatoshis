const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const {encryptToNode} = require('../encryption');
const {homePath} = require('../storage');

const nostrKeyFile = 'nostr_private_key';


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

      // Save the encrypted nostr private key
      saveKey: ['encryptKey', 'registerHomeDir', ({encryptKey}, cbk) => {
        const {path} = homePath({file: nostrKeyFile});

        return args.fs.writeFile(path, encryptKey.encrypted, err => {
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
