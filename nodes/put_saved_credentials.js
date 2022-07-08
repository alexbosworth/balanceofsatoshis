const {join} = require('path');

const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const {homePath} = require('../storage');

const credentials = 'credentials.json';
const {isArray} = Array;
const stringify = obj => JSON.stringify(obj, null, 2);

/** Write saved credentials for node

  {
    [cert]: <Base64 Encoded Node TLS Certificate String>
    [encrypted_macaroon]: <Encrypted Macaroon String>
    [encrypted_to]: [<Macaroon Encrypted To Recipient Id String>]
    fs: {
      makeDirectory: <Make Directory Function>
      writeFile: <Write File Contents Function> (path, contents, cbk) => {}
    }
    [macaroon]: <Base64 Encoded Macaroon String>
    node: <Node Name String>
    socket: <Node Socket String>
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!!args.encrypted_macaroon && !isArray(args.encrypted_to)) {
          return cbk([400, 'ExpectedRecipientIdsForEncryptedMacaroon']);
        }

        if (!!args.encrypted_macaroon && !!args.macaroon) {
          return cbk([400, 'UnexpectedUnencryptedMacaroon']);
        }

        if (!args.encrypted_macaroon && !args.macaroon) {
          return cbk([400, 'ExpectedMacaroonForSavedCredentials']);
        }

        if (!args.fs || !args.fs.writeFile) {
          return cbk([400, 'ExpectedFileSystemMethodsToPutSavedCredentials']);
        }

        if (!args.node) {
          return cbk([400, 'ExpectedNodeNameToPutSavedCredentials']);
        }

        if (!args.socket) {
          return cbk([400, 'ExpectedSocketForNodeToPutSavedCredentials']);
        }

        return cbk();
      },

      // Make sure the node directory is there
      registerDirectory: ['validate', ({}, cbk) => {
        return args.fs.makeDirectory(homePath({file: args.node}).path, err => {
          // Ignore errors, the directory may already be there
          return cbk();
        });
      }],

      // Write credentials
      writeCredentials: ['registerDirectory', ({}, cbk) => {
        const file = stringify({
          cert: args.cert || undefined,
          encrypted_macaroon: args.encrypted_macaroon || undefined,
          encrypted_to: args.encrypted_to || undefined,
          macaroon: args.macaroon || undefined,
          socket: args.socket,
        });

        const path = join(...[homePath({}).path, args.node, credentials]);

        return args.fs.writeFile(path, file, err => {
          if (!!err) {
            return cbk([503, 'UnexpectedErrorWritingSavedCredentials', {err}]);
          }

          return cbk();
        });
      }],
    },
    returnResult({reject, resolve, of: 'getCredentials'}, cbk));
  });
};
