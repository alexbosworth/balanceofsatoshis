const {publicEncrypt} = require('crypto');
const {readFile} = require('fs');
const {spawn} = require('child_process');

const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const {decryptCiphertext} = require('./../encryption');
const {derAsPem} = require('./../encryption');
const getCert = require('./get_cert');
const getMacaroon = require('./get_macaroon');
const {getSavedCredentials} = require('./../nodes');
const getSocket = require('./get_socket');

const socket = 'localhost:10009';

/** LND credentials

  {
    [key]: <Encrypt to Public Key DER Hex String>
    [logger]: <Winston Logger Object>
    [node]: <Node Name String> // Defaults to default local mainnet node creds
  }

  @returns via cbk or Promise
  {
    cert: <Cert String>
    [encrypted_macaroon]: <Encrypted Macaroon Base64 String>
    [external_socket]: <External RPC Socket String>
    macaroon: <Macaroon String>
    socket: <Socket String>
  }
*/
module.exports = ({logger, key, node}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Get the default cert
      getCert: cbk => getCert({node, fs: {getFile: readFile}}, cbk),

      // Get the default macaroon
      getMacaroon: cbk => getMacaroon({node, fs: {getFile: readFile}}, cbk),

      // Get the node credentials, if applicable
      getNodeCredentials: cbk => {
        if (!node) {
          return cbk();
        }

        return getSavedCredentials({node, fs: {getFile: readFile}}, cbk);
      },

      // Get the socket out of the ini file
      getSocket: cbk => getSocket({node, fs: {getFile: readFile}}, cbk),

      // Node credentials
      nodeCredentials: ['getNodeCredentials', ({getNodeCredentials}, cbk) => {
        if (!node) {
          return cbk();
        }

        if (!getNodeCredentials.credentials) {
          return cbk([400, 'CredentialsForSpecifiedNodeNotFound']);
        }

        const {credentials} = getNodeCredentials;

        if (!credentials.encrypted_macaroon) {
          return cbk(null, {
            cert: credentials.cert,
            macaroon: credentials.macaroon,
            socket: credentials.socket,
          });
        }

        const cipher = credentials.encrypted_macaroon;

        if (!!logger) {
          logger.info({decrypt_credentials_for: node});
        }

        return decryptCiphertext({cipher, spawn}, (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          return cbk(null, {
            cert: credentials.cert,
            macaroon: res.clear,
            socket: credentials.socket,
          });
        });
      }],

      // Credentials to use
      credentials: [
        'getCert',
        'getMacaroon',
        'nodeCredentials',
        ({getCert, getMacaroon, nodeCredentials}, cbk) =>
      {
        // Exit early with the default credentials when no node is specified
        if (!node) {
          return cbk(null, {
            socket,
            cert: getCert.cert,
            macaroon: getMacaroon.macaroon,
          });
        }

        return cbk(null, {
          cert: nodeCredentials.cert,
          macaroon: nodeCredentials.macaroon,
          socket: nodeCredentials.socket,
        });
      }],

      // Final credentials with encryption applied
      finalCredentials: [
        'credentials',
        'getSocket',
        ({credentials, getSocket}, cbk) =>
      {
        // Exit early when the credentials are not encrypted
        if (!key) {
          return cbk(null, credentials);
        }

        const macaroon = Buffer.from(credentials.macaroon, 'base64');

        const encrypted = publicEncrypt(derAsPem({key}).pem, macaroon);

        return cbk(null, {
          cert: credentials.cert,
          encrypted_macaroon: encrypted.toString('base64'),
          external_socket: getSocket.socket,
          socket: credentials.socket,
        });
      }],
    },
    returnResult({reject, resolve, of: 'finalCredentials'}, cbk));
  });
};
