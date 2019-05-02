const {join} = require('path');
const {homedir} = require('os');
const {readFile} = require('fs');

const asyncAuto = require('async/auto');
const asyncDetectSeries = require('async/detectSeries');
const {flatten} = require('lodash');

const lndDirectory = require('./lnd_directory');
const {returnResult} = require('./../async');

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
    [node]: <Node Name String> // Defaults to default local mainnet node creds
  }

  @returns
  {
    cert: <Cert String>
    macaroon: <Macaroon String>
    socket: <Socket String>
  }
*/
module.exports = ({node}, cbk) => {
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

      const all = chains.map(chain => nets.map(network => ({chain, network})));

      // Find the default macaroon
      return asyncDetectSeries(flatten(all), ({chain, network}, cbk) => {
        const macPath = [].concat(pathToMac).concat([chain, network, macName]);

        return readFile(join(...[path].concat(macPath)), (_, macaroon) => {
          return cbk(null, macaroon);
        });
      },
      (err, macaroon) => {
        if (!!err || !macaroon) {
          return cbk([503, 'FailedToGetCertFileData', err]);
        }

        return cbk(null, macaroon.toString(base64));
      });
    },

    // Get the node credentials, if applicable
    getNodeCredentials: cbk => {
      if (!node) {
        return cbk();
      }

      const path = [homedir(), home, node, credsFile];

      return readFile(join(...path), (err, creds) => {
        if (!!err) {
          return cbk([503, 'FailedToGetNodeCredentials', err]);
        }

        try {
          parse(creds);
        } catch (err) {
          return cbk([503, 'FailedToParseNodeCredentials', err]);
        }

        const {cert, macaroon, socket} = parse(creds);

        if (!cert) {
          return cbk([503, 'FailedToFindCertInCredentials']);
        }

        if (!macaroon) {
          return cbk([503, 'FailedToFindMacaroonInCredentials']);
        }

        if (!socket) {
          return cbk([503, 'FailedToFindSocketInCredentials']);
        }

        return cbk(null, {cert, macaroon, socket});
      });
    },

    // Credentials to use
    credentials: [
      'getCert',
      'getMacaroon',
      'getNodeCredentials',
      ({getCert, getMacaroon, getNodeCredentials}) =>
    {
      // Exit early with the default credentials when no node is specified
      if (!node) {
        return cbk(null, {socket, cert: getCert, macaroon: getMacaroon});
      }

      return cbk(null, {
        cert: getNodeCredentials.cert,
        macaroon: getNodeCredentials.macaroon,
        socket: getNodeCredentials.socket,
      });
    }],
  },
  returnResult({of: 'credentials'}, cbk))
};
