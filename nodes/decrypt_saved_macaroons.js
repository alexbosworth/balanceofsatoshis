const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const asyncMapSeries = require('async/mapSeries');
const {returnResult} = require('asyncjs-util');

const {decryptCiphertext} = require('./../encryption');
const getSavedCredentials = require('./get_saved_credentials');
const putSavedCredentials = require('./put_saved_credentials');

const {isArray} = Array;

/** Decrypt saved macaroons and save as cleartext

  {
    fs: {
      getFile: <Read File Contents Function> (path, cbk) => {}
      writeFile: <Write File Contents Function> (path, contents, cbk) => {}
    }
    logger: <Winston Logger Object>
    nodes: [<Node Name String>]
    spawn: <Spawn Function>
  }

  @returns via cbk or Promise
*/
module.exports = ({fs, logger, nodes, spawn}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!fs) {
          return cbk([400, 'ExpectedFileMethodsToDecryptSavedMacaroons']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedLoggerToDecryptSavedMacaroons']);
        }

        if (!isArray(nodes)) {
          return cbk([400, 'ExpectedNodesToDecryptSavedMacaroons']);
        }

        if (!spawn) {
          return cbk([400, 'ExpectedSpawnFunctionToDecryptSavedMacaroons']);
        }

        return cbk();
      },

      // Get the credentials
      getCredentials: ['validate', ({}, cbk) => {
        return asyncMap(nodes, (node, cbk) => {
          return getSavedCredentials({fs, node}, cbk);
        },
        cbk);
      }],

      // Decrypt the encrypted macaroons
      decrypt: ['getCredentials', ({getCredentials}, cbk) => {
        const encrypted = getCredentials
          .filter(n => !!n.credentials.encrypted_macaroon);

        return asyncMapSeries(encrypted, ({credentials, node}, cbk) => {
          const cipher = credentials.encrypted_macaroon;

          logger.info({decrypt_credentials_for: node});

          return decryptCiphertext({cipher, spawn}, (err, res) => {
            if (!!err) {
              return cbk([503, 'UnexpectedErrorDecryptingMacaroon', {err}]);
            }

            return cbk(null, {credentials, macaroon: res.clear, node});
          });
        },
        cbk);
      }],

      // Save the decrypted credentials over the existing credentials
      save: ['decrypt', ({decrypt}, cbk) => {
        if (!decrypt.length) {
          return cbk();
        }

        return asyncMap(decrypt, ({credentials, macaroon, node}, cbk) => {
          return putSavedCredentials({
            fs,
            macaroon,
            node,
            cert: credentials.cert,
            socket: credentials.socket,
          },
          cbk);
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}));
  });
};
