const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const asyncMapSeries = require('async/mapSeries');
const {returnResult} = require('asyncjs-util');

const decryptSavedMacaroons = require('./decrypt_saved_macaroons');
const {encryptToPublicKeys} = require('./../encryption');
const getSavedCredentials = require('./get_saved_credentials');
const putSavedCredentials = require('./put_saved_credentials');

const ids = n => n.slice().sort().join(',');
const {isArray} = Array;
const notFoundIndex = -1;

/** Encrypt saved macaroons to GPG keys

  {
    fs: {
      getFile: <Read File Contents Function> (path, cbk) => {}
      writeFile: <Write File Contents Function> (path, contents, cbk) => {}
    }
    logger: <Winston Logger Object>
    nodes: [<Node Name String>]
    to: [<Encrypt to GPG Key Id String>]
  }

  @returns via cbk or Promise
*/
module.exports = ({fs, logger, nodes, to}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!fs || !fs.getFile || !fs.writeFile) {
          return cbk([400, 'ExpectedFilesystemMethodsToSaveEncrypted']);
        }

        if (!isArray(nodes) || !nodes.length) {
          return cbk([400, 'ExpectedNodesToEncryptSavedMacaroonsFor']);
        }

        if (!isArray(to) || !to.length) {
          return cbk([400, 'ExpectedGpgKeyIdsToEncryptSavedMacaroonsTo']);
        }

        if (to.findIndex(n => typeof(n) !== 'string') !== notFoundIndex) {
          return cbk([400, 'ExpectedGpgKeyId']);
        }

        return cbk();
      },

      // Get the credentials including encrypted credentials
      getAllCredentials: ['validate', ({}, cbk) => {
        return asyncMap(nodes, (node, cbk) => {
          return getSavedCredentials({fs, node}, cbk);
        },
        cbk);
      }],

      // Decrypt macaroons for nodes that have the wrong keys
      decryptEncrypted: ['getAllCredentials', ({getAllCredentials}, cbk) => {
        const nodes = getAllCredentials
          .filter(n => !!n.credentials && !!n.credentials.encrypted_macaroon)
          .filter(n => ids(n.credentials.encrypted_to) !== ids(to))
          .map(n => n.node);

        if (!nodes.length) {
          return cbk();
        }

        return decryptSavedMacaroons({fs, logger, nodes}, cbk);
      }],

      // Get the credentials
      getCredentials: ['decryptEncrypted', ({}, cbk) => {
        return asyncMap(nodes, (node, cbk) => {
          return getSavedCredentials({fs, node}, cbk);
        },
        cbk);
      }],

      // Encrypt unencrypted macaroons
      encrypt: ['getCredentials', ({getCredentials}, cbk) => {
        const plainCredentials = getCredentials
          .filter(n => !!n.credentials && !!n.credentials.macaroon);

        return asyncMapSeries(plainCredentials, ({credentials, node}, cbk) => {
          const plain = credentials.macaroon;

          return encryptToPublicKeys({plain, to}, (err, res) => {
            if (!!err) {
              return cbk([503, 'UnexpectedErrorEncryptingMacaroon', {err}]);
            }

            return cbk(null, {credentials, node, cipher: res.cipher});
          });
        },
        cbk);
      }],

      // Save the encrypted credentials over the existing credentials
      save: ['encrypt', ({encrypt}, cbk) => {
        if (!encrypt.length) {
          return cbk();
        }

        return asyncMap(encrypt, ({credentials, node, cipher}, cbk) => {
          return putSavedCredentials({
            fs,
            node,
            cert: credentials.cert,
            encrypted_macaroon: cipher,
            encrypted_to: to,
            socket: credentials.socket,
          },
          cbk);
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
