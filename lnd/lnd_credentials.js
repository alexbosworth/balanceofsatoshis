const {homedir} = require('os');
const {join} = require('path');
const {platform} = require('os');
const {publicEncrypt} = require('crypto');
const {readFile} = require('fs');
const {spawn} = require('child_process');
const {userInfo} = require('os');

const asyncAuto = require('async/auto');
const {authenticatedLndGrpc} = require('ln-service');
const {grantAccess} = require('ln-service');
const {restrictMacaroon} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const credentialRestrictions = require('./credential_restrictions');
const {decryptCiphertext} = require('./../encryption');
const {derAsPem} = require('./../encryption');
const getCert = require('./get_cert');
const getMacaroon = require('./get_macaroon');
const getPath = require('./get_path');
const {getSavedCredentials} = require('./../nodes');
const getSocket = require('./get_socket');
const {noSpendPerms} = require('./constants');
const {permissionEntities} = require('./constants');
const {homePath} = require('../storage');

const config = 'config.json';
const defaultLndDirPath = process.env.BOS_DEFAULT_LND_PATH;
const defaultNodeName = process.env.BOS_DEFAULT_SAVED_NODE;
const fs = {getFile: readFile};
const os = {homedir, platform, userInfo};
const {parse} = JSON;
const readPerms = permissionEntities.map(entity => `${entity}:read`);
const socket = 'localhost:10009';

/** LND credentials

  {
    [expiry]: <Credential Expiration Date ISO 8601 Date String>
    [is_nospend]: <Restrict Credentials To Non-Spending Permissions Bool>
    [is_readonly]: <Restrict Credentials To Read-Only Permissions Bool>
    [key]: <Encrypt to Public Key DER Hex String>
    [logger]: <Winston Logger Object>
    [methods]: [<Allow Specific Method String>]
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
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Figure out which node the credentials are for
      forNode: cbk => {
        if (!!args.node) {
          return cbk(null, args.node);
        }

        if (!!defaultNodeName) {
          return cbk(null, defaultNodeName);
        }

        const path = join(...[homePath({}), config]);

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

      // Look for a special path
      getPath: ['forNode', ({forNode}, cbk) => {
        // Exit early when a specific node is used
        if (!!forNode) {
          return cbk(null, {});
        }

        // Exit early when there is a default LND path
        if (!!defaultLndDirPath) {
          return cbk(null, {path: defaultLndDirPath});
        }

        return getPath({fs, os}, cbk);
      }],

      // Get the default cert
      getCert: ['forNode', 'getPath', ({forNode, getPath}, cbk) => {
        return getCert({fs, os, node: forNode, path: getPath.path}, cbk);
      }],

      // Get the default macaroon
      getMacaroon: ['forNode', 'getPath', ({forNode, getPath}, cbk) => {
        return getMacaroon({fs, os, node: forNode, path: getPath.path}, cbk);
      }],

      // Get the node credentials, if applicable
      getNodeCredentials: ['forNode', ({forNode}, cbk) => {
        if (!forNode) {
          return cbk();
        }

        return getSavedCredentials({fs, node: forNode}, cbk);
      }],

      // Get the socket out of the ini file
      getSocket: ['forNode', 'getPath', ({forNode, getPath}, cbk) => {
        return getSocket({fs, os, node: forNode, path: getPath.path}, cbk);
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

        if (!!args.logger) {
          args.logger.info({decrypt_credentials_for: forNode});
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
        'getSocket',
        'nodeCredentials',
        ({forNode, getCert, getMacaroon, getSocket, nodeCredentials}, cbk) =>
      {
        // Exit early with the default credentials when no node is specified
        if (!forNode) {
          return cbk(null, {
            cert: getCert.cert,
            macaroon: getMacaroon.macaroon,
            socket: getSocket.socket || socket,
          });
        }

        return cbk(null, {
          cert: nodeCredentials.cert,
          macaroon: nodeCredentials.macaroon,
          socket: getSocket.socket || nodeCredentials.socket,
        });
      }],

      // Macaroon with restriction
      macaroon: ['credentials', ({credentials}, cbk) => {
        if (!args.expiry) {
          return cbk(null, credentials.macaroon);
        }

        const {macaroon} = restrictMacaroon({
          expires_at: args.expiry,
          macaroon: credentials.macaroon,
        });

        return cbk(null, macaroon);
      }],

      // Get read-only macaroon if necessary
      restrictMacaroon: [
        'credentials',
        'macaroon',
        ({credentials, macaroon}, cbk) =>
      {
        const {allow} = credentialRestrictions({
          is_nospend: args.is_nospend,
          is_readonly: args.is_readonly,
          methods: args.methods,
        });

        // Exit early when readonly credentials are not requested
        if (!allow) {
          return cbk(null, {macaroon});
        }

        const {lnd} = authenticatedLndGrpc({
          macaroon,
          cert: credentials.cert,
          socket: credentials.socket,
        });

        return grantAccess({
          lnd,
          methods: allow.methods,
          permissions: allow.permissions,
        },
        cbk);
      }],

      // Final credentials with encryption applied
      finalCredentials: [
        'credentials',
        'getSocket',
        'restrictMacaroon',
        ({credentials, getSocket, restrictMacaroon}, cbk) =>
      {
        // Exit early when the credentials are not encrypted
        if (!args.key) {
          return cbk(null, {
            macaroon: restrictMacaroon.macaroon,
            cert: credentials.cert,
            socket: credentials.socket.trim(),
          });
        }

        const macaroonData = Buffer.from(restrictMacaroon.macaroon, 'base64');
        const {pem} = derAsPem({key: args.key});

        const encrypted = publicEncrypt(pem, macaroonData);

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
