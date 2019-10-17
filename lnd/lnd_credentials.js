const {join} = require('path');
const {homedir} = require('os');
const {readFile} = require('fs');

const asyncAuto = require('async/auto');
const asyncDetectSeries = require('async/detectSeries');
const {flatten} = require('lodash');
const {returnResult} = require('asyncjs-util');

const {decryptCiphertext} = require('./../encryption');
const {getSavedCredentials} = require('./../nodes');
const lndDirectory = require('./lnd_directory');

const base64 = 'base64';
const certPath = ['tls.cert'];
const credsFile = 'credentials.json';
const defaults = [['bitcoin', 'litecoin'], ['mainnet', 'testnet']];
const home = '.bos';
const macName = 'admin.macaroon';
const {parse} = JSON;
const {path} = lndDirectory({});
const pathToMac = ['data', 'chain'];
const socket = 'localhost:10009';

/** Lnd credentials

  {
    [logger]: <Winston Logger Object>
    [node]: <Node Name String> // Defaults to default local mainnet node creds
  }

  @returns via cbk or Promise
  {
    cert: <Cert String>
    macaroon: <Macaroon String>
    socket: <Socket String>
  }
*/
module.exports = ({logger, node}, cbk) => {
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
        ({getCert, getMacaroon, nodeCredentials}) =>
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
    },
    returnResult({reject, resolve, of: 'credentials'}, cbk));
  });
};
