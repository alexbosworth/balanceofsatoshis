const {homedir} = require('os');
const {join} = require('path');

const asyncAuto = require('async/auto');
const {decodeFirst} = require('cbor');
const inquirer = require('inquirer');
const {returnResult} = require('asyncjs-util');
const sanitize = require('sanitize-filename');

const {derAsPem} = require('./../encryption');
const {home} = require('../storage');
const putSavedCredentials = require('./put_saved_credentials');

const credentialsFileName = 'credentials.json';
const defaultHost = 'localhost';
const defaultRpcPort = 10009;
const keyType = 'rsa';
const modulusLength = 4096;
const privateKeyEncoding = {format: 'pem', type: 'pkcs8'};
const publicKeyEncoding = {format: 'der', type: 'spki'};

/** Add or update a saved node

  {
    ask: <Inquirer Function> ({message, name, type}, cbk) => {}
    cryptography: {
      generateKeyPair: <Generate Key Pair Function> (keyType, options) => {}
    }
    fs: {
      makeDirectory: <Make Directory Function>
      writeFile: <Write File Function>
    }
    logger: <Winston Logger Object>
    [node]: <Node Name String>
  }

  @returns via cbk or Promise
*/
module.exports = ({ask, cryptography, fs, logger, node}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!ask) {
          return cbk([400, 'ExpectedAskFunctionToRegisterSavedNode']);
        }

        if (!cryptography) {
          return cbk([400, 'ExpectedCryptographyFunctionsToRegisterNode']);
        }

        if (!fs) {
          return cbk([400, 'ExpectedFileSystemMethodsToRegisterSavedNode']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedLoggerToRegisterSavedNode']);
        }

        return cbk();
      },

      // Make sure the home directory is there
      registerHomeDirectory: ['validate', ({}, cbk) => {
        return fs.makeDirectory(join(...[homedir(), home()]), err => {
          // Ignore errors, the directory may already be there
          return cbk();
        });
      }],

      // Start import
      startImport: ['validate', ({}, cbk) => {
        const cmd = 'bos credentials';

        const start = {
          message: `Step 1. Run "${cmd}" on the node to add. Continue?`,
          name: 'start',
          type: 'confirm',
        };

        return ask(start, ({start}) => {
          if (!start) {
            return cbk([400, 'CanceledNodeRegistration']);
          }

          return cbk();
        });
      }],

      // Generate transfer key
      transferKey: ['validate', ({}, cbk) => {
        return cryptography.generateKeyPair(keyType, {
          modulusLength,
          privateKeyEncoding,
          publicKeyEncoding,
        },
        (err, publicKey, privateKey) => {
          if (!!err) {
            return cbk([503, 'FailedToGenerateCredentialsKey', {err}]);
          }

          return cbk(null, {private_key: privateKey, public_key: publicKey});
        });
      }],

      // Copy travel key
      copyKey: ['startImport', 'transferKey', ({transferKey}, cbk) => {
        const key = Buffer.from(transferKey.public_key).toString('hex');

        logger.info({credentials_transfer_public_key: key});

        const copyPrompt = {
          message: `Step 2. Enter the transfer key on target node. Continue?"`,
          name: 'copied',
          type: 'confirm',
        };

        return ask(copyPrompt, ({copied}) => {
          if (!copied) {
            return cbk([400, 'CanceledNodeRegistration']);
          }

          return cbk();
        });
      }],

      // Enter CBOR encoded credentials
      enterCredentials: ['copyKey', 'transferKey', ({transferKey}, cbk) => {
        const credentialsPrompt = {
          message: 'Step 3: Enter the credentials you got after pasting:',
          name: 'credentials',
          type: 'input',
        };

        return ask(credentialsPrompt, ({credentials}) => {
          if (!credentials) {
            return cbk([400, 'ExpectedCredentialsForRemoteNode']);
          }

          return cbk(null, credentials);
        });
      }],

      // Decode credentials
      decodeCredentials: ['enterCredentials', ({enterCredentials}, cbk) => {
        const encoded = Buffer.from(enterCredentials, 'hex');

        return decodeFirst(encoded, (err, node) => {
          if (!!err) {
            return cbk([400, 'ExpectedValidEncodedCredentials', {err}]);
          }

          if (!node.cert) {
            return cbk([400, 'ExpectedTlsCertInCredentials']);
          }

          if (!node.encrypted_macaroon) {
            return cbk([400, 'ExpectedEncryptedMacaroonInCredentials']);
          }

          const {pem} = derAsPem({cert: node.cert});

          return cbk(null, {
            cert: Buffer.from(pem).toString('base64'),
            encrypted_macaroon: node.encrypted_macaroon,
            socket: node.socket || undefined,
          });
        });
      }],

      // Socket details
      socket: ['decodeCredentials', ({decodeCredentials}, cbk) => {
        if (!decodeCredentials.socket) {
          return cbk(null, {host: defaultHost, port: defaultRpcPort});
        }

        try {
          const url = new URL(`rpc://${decodeCredentials.socket}`);

          return cbk(null, {host: url.hostname, port: Number(url.port)});
        } catch (err) {
          return cbk([400, 'ExpectedStandardSocketInCredentials', {err}]);
        }
      }],

      // Enter Host
      enterHost: ['socket', ({socket}, cbk) => {
        const hostPrompt = {
          default: socket.host,
          message: `Node RPC host (defaults to: ${socket.host})`,
          name: 'host',
          type: 'input',
        };

        return ask(hostPrompt, ({host}) => {
          if (!host) {
            return cbk([400, 'ExpectedHostForNodeCredentials']);
          }

          return cbk(null, host);
        });
      }],

      // Enter Port
      enterPort: ['enterHost', 'socket', ({socket}, cbk) => {
        const defaultPort = socket.port || defaultRpcPort;

        const portPrompt = {
          default: defaultPort,
          message: `Node RPC port (defaults to: ${defaultPort})`,
          name: 'port',
          type: 'number',
        };

        return ask(portPrompt, ({port}) => {
          if (!port) {
            return cbk([400, 'ExpectedPortForNodeCredentials']);
          }

          return cbk(null, port);
        });
      }],

      // Decrypt macaroon
      decryptMacaroon: [
        'decodeCredentials',
        'transferKey',
        ({decodeCredentials, transferKey}, cbk) =>
      {
        const encryptedMacaroon = decodeCredentials.encrypted_macaroon;
        const privateKey = transferKey.private_key;

        const cipher = Buffer.from(encryptedMacaroon, 'base64');

        try {
          return cbk(null, cryptography.privateDecrypt(privateKey, cipher));
        } catch (err) {
          return cbk([400, 'FailedToDecryptNodeMacaroon', {err}]);
        }
      }],

      // Node details
      details: [
        'decodeCredentials',
        'decryptMacaroon',
        'enterHost',
        'enterPort',
        ({decodeCredentials, decryptMacaroon, enterHost, enterPort}, cbk) =>
      {
        const rawCert = Buffer.from(decodeCredentials.cert.toString('base64'))
          .toString();

        const rawCertLines = Buffer.from(rawCert, 'base64').toString()
            .split('\n');

        const cert = Buffer.from(rawCertLines.join('\n') + '\n')
          .toString('base64');

        const macaroon = decryptMacaroon.toString('base64');
        const socket = `${enterHost}:${enterPort}`;

        return cbk(null, {cert, macaroon, socket});
      }],

      // Name for node
      nodeName: ['details', ({details}, cbk) => {
        if (!!node) {
          return cbk(null, node);
        }

        const namePrompt = {
          message: 'Name for this node?',
          name: 'moniker',
          type: 'input',
        };

        return ask(namePrompt, ({moniker}) => {
          if (!moniker) {
            return cbk([400, 'CanceledNodeRegistration']);
          }

          const sanitized = sanitize(moniker);

          if (moniker !== sanitized) {
            return cbk([400, 'InvalidNameForNode', {suggested: sanitized}]);
          }

          return cbk(null, moniker);
        });
      }],

      // Make sure the node directory is there
      nodeDir: [
        'details',
        'nodeName',
        'registerHomeDirectory', ({nodeName}, cbk) =>
      {
        return fs.makeDirectory(join(...[homedir(), home(), nodeName]), err => {
          // Ignore errors, the directory may already be there
          return cbk();
        });
      }],

      // Save details
      save: ['details', 'nodeName', 'nodeDir', ({details, nodeName}, cbk) => {
        return putSavedCredentials({
          fs,
          cert: details.cert,
          macaroon: details.macaroon,
          node: nodeName,
          socket: details.socket,
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
