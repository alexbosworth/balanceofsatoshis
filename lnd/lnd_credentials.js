const {homedir} = require('os');
const {join} = require('path');
const {platform} = require('os');
const {publicEncrypt} = require('crypto');
const {readFile} = require('fs');
const {spawn} = require('child_process');

const asyncAuto = require('async/auto');
const {restrictMacaroon} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const {decryptCiphertext} = require('./../encryption');
const {derAsPem} = require('./../encryption');
const getCert = require('./get_cert');
const getMacaroon = require('./get_macaroon');
const {getSavedCredentials} = require('./../nodes');
const getSocket = require('./get_socket');

const config = 'config.json';
const defaultNodeName = process.env.BOS_DEFAULT_SAVED_NODE;
const fs = {getFile: readFile};
const home = '.bos';
const os = {homedir, platform};
const {parse} = JSON;
const socket = 'localhost:10009';

/** LND credentials

  {
    [expiry]: <Credential Expiration Date ISO 8601 Date String>
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
module.exports = ({expiry, logger, key, node}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Figure out which node the credentials are for
      forNode: cbk => {
        if (!!node) {
          return cbk(null, node);
        }

        if (!!defaultNodeName) {
          return cbk(null, defaultNodeName);
        }

        const path = join(...[homedir(), home, config]);

        return fs.getFile(path, (err, res) => {
          // Exit early on errors, there is no config found
          if (!!err || !res) {
            return cbk();
          }

          try {
            parse(res.toString());
          } catch (err) {
            return cbk([400, 'ConfigurationFileIsInvalidFormat', {err}]);
          }

          const config = parse(res.toString());

          if (!!config.default_saved_node) {
            return cbk(null, config.default_saved_node);
          }

          return cbk();
        });
      },

      // Get the default cert
      getCert: ['forNode', ({forNode}, cbk) => {
        return getCert({fs, os, node: forNode}, cbk);
      }],

      // Get the default macaroon
      getMacaroon: ['forNode', ({forNode}, cbk) => {
        return getMacaroon({fs, os, node: forNode}, cbk);
      }],

      // Get the node credentials, if applicable
      getNodeCredentials: ['forNode', ({forNode}, cbk) => {
        if (!forNode) {
          return cbk();
        }

        return getSavedCredentials({fs, node: forNode}, cbk);
      }],

      // Get the socket out of the ini file
      getSocket: ['forNode', ({forNode}, cbk) => {
        return getSocket({fs, os, node: forNode}, cbk);
      }],

      // Node credentials
      nodeCredentials: [
        'forNode',
        'getNodeCredentials',
        ({forNode, getNodeCredentials}, cbk) =>
      {
        if (!forNode) {
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
          logger.info({decrypt_credentials_for: forNode});
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
        'forNode',
        'getCert',
        'getMacaroon',
        'nodeCredentials',
        ({forNode, getCert, getMacaroon, nodeCredentials}, cbk) =>
      {
        // Exit early with the default credentials when no node is specified
        if (!forNode) {
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

      // Macaroon with restriction
      macaroon: ['credentials', ({credentials}, cbk) => {
        if (!expiry) {
          return cbk(null, credentials.macaroon);
        }

        const {macaroon} = restrictMacaroon({
          expires_at: expiry,
          macaroon: credentials.macaroon,
        });

        return cbk(null, macaroon);
      }],

      // Final credentials with encryption applied
      finalCredentials: [
        'credentials',
        'getSocket',
        'macaroon',
        ({credentials, getSocket, macaroon}, cbk) =>
      {
        // Exit early when the credentials are not encrypted
        if (!key) {
          return cbk(null, {
            macaroon,
            cert: credentials.cert,
            socket: credentials.socket,
          });
        }

        const macaroonData = Buffer.from(macaroon, 'base64');

        const encrypted = publicEncrypt(derAsPem({key}).pem, macaroonData);

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
