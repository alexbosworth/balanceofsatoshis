const {join} = require('path');
const {homedir} = require('os');
const {publicEncrypt} = require('crypto');
const {readFile} = require('fs');
const {URL} = require('url');

const asyncAuto = require('async/auto');
const asyncDetectSeries = require('async/detectSeries');
const {flatten} = require('lodash');
const ini = require('ini');
const {returnResult} = require('asyncjs-util');

const {decryptCiphertext} = require('./../encryption');
const {derAsPem} = require('./../encryption');
const {getSavedCredentials} = require('./../nodes');
const lndDirectory = require('./lnd_directory');

const base64 = 'base64';
const certPath = ['tls.cert'];
const credsFile = 'credentials.json';
const confPath = ['lnd.conf'];
const defaults = [['bitcoin', 'litecoin'], ['mainnet', 'testnet']];
const home = '.bos';
const macName = 'admin.macaroon';
const {parse} = JSON;
const {path} = lndDirectory({});
const pathToMac = ['data', 'chain'];
const socket = 'localhost:10009';

/** Lnd credentials

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
      getCert: cbk => {
        if (!!node) {
          return cbk();
        }

        return readFile(join(...[path].concat(certPath)), (err, cert) => {
          if (!!err || !cert) {
            return cbk([503, 'FailedToGetCertFileData', err]);
          }

          return cbk(null, cert.toString(base64));
        });
      },

      // Get the default macaroon
      getMacaroon: cbk => {
        if (!!node) {
          return cbk();
        }

        const [chains, nets] = defaults;

        const all = chains.map(chain => {
          return nets.map(network => ({chain, network}))
        });

        // Find the default macaroon
        return asyncDetectSeries(flatten(all), ({chain, network}, cbk) => {
          const macPath = []
            .concat(pathToMac)
            .concat([chain, network, macName]);

          return readFile(join(...[path].concat(macPath)), (_, macaroon) => {
            return cbk(null, macaroon);
          });
        },
        (err, macaroon) => {
          if (!!err || !macaroon) {
            return cbk([503, 'FailedToGetMacFileData', err]);
          }

          const {chain, network} = macaroon;

          const macPath = []
            .concat(pathToMac)
            .concat([chain, network, macName]);

          return readFile(join(...[path].concat(macPath)), (err, macaroon) => {
            if (!!err) {
              return cbk([503, 'FailedToGetMacaroonData', {err}]);
            }

            return cbk(null, macaroon.toString(base64));
          });
        });
      },

      // Get the node credentials, if applicable
      getNodeCredentials: cbk => {
        if (!node) {
          return cbk();
        }

        return getSavedCredentials({node, fs: {getFile: readFile}}, cbk);
      },

      // Get socket
      getSocket: cbk => {
        // Exit early when a saved node is specified
        if (!!node) {
          return cbk();
        }

        return readFile(join(...[path].concat(confPath)), (err, conf) => {
          if (!!err || !conf) {
            return cbk();
          }

          try {
            ini.parse(conf.toString())
          } catch (err) {
            return cbk();
          }

          const configuration = ini.parse(conf.toString())

          const applicationOptions = configuration['Application Options'];

          if (!applicationOptions) {
            return cbk();
          }

          const ip = applicationOptions.tlsextraip;

          if (!ip) {
            return cbk();
          }

          try {
            if (!(new URL(`rpc://${applicationOptions.rpclisten}`).port)) {
              return cbk();
            }
          } catch (err) {
            return cbk();
          }

          const {port} = new URL(`rpc://${applicationOptions.rpclisten}`);

          return cbk(null, {external_socket: `${ip}:${port}`});
        });
      },

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

        return decryptCiphertext({cipher}, (err, res) => {
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
          return cbk(null, {socket, cert: getCert, macaroon: getMacaroon});
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
          external_socket: !!getSocket ? getSocket.external_socket : undefined,
          socket: credentials.socket,
        });
      }],
    },
    returnResult({reject, resolve, of: 'finalCredentials'}, cbk));
  });
};
