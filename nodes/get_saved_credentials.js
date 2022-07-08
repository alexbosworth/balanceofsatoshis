const {join} = require('path');

const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const {homePath} = require('../storage');

const credentials = 'credentials.json';
const {isArray} = Array;
const {parse} = JSON;

/** Get saved credentials for node

  {
    fs: {
      getFile: <Read File Contents Function> (path, cbk) => {}
    }
    node: <Node Name String>
  }

  @returns via cbk or Promise
  {
    [credentials]: {
      [cert]: <Base64 or Hex Serialized LND TLS Cert>
      [encrypted_macaroon]: <Encrypted Macaroon String>
      [encrypted_to]: [<Encrypted to GPG Recipient String>]
      [macaroon]: <Base64 or Hex Serialized Macaroon String>
      socket: <Host:Port Network Address String>
    }
    node: <Node Name String>
  }
*/
module.exports = ({fs, node}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!fs || !fs.getFile) {
          return cbk([400, 'ExpectedFileGetMethodToGetSavedCredentials']);
        }

        if (!node) {
          return cbk([400, 'ExpectedNodeNameToGetSavedCredentials']);
        }

        if (!!isArray(node)) {
          return cbk([400, 'ExpectedSingleSavedNodeNameToGetCredentialsFor']);
        }

        return cbk();
      },

      // Get the credentials file
      getFile: ['validate', ({}, cbk) => {
        const path = join(...[homePath({}).path, node, credentials]);

        return fs.getFile(path, (err, res) => {
          // Exit early on errors, there is no credential found
          if (!!err || !res) {
            return cbk(null, {node});
          }

          try {
            parse(res.toString());
          } catch (err) {
            return cbk([400, 'SavedNodeHasInvalidCredentials']);
          }

          const credentials = parse(res.toString());

          return cbk(null, credentials);
        });
      }],

      // Get cert from path if necessary
      getCert: ['getFile', ({getFile}, cbk) => {
        if (!getFile.cert_path) {
          return cbk(null, getFile.cert);
        }

        return fs.getFile(getFile.cert_path, (err, res) => {
          if (!!err) {
            return cbk([400, 'SavedNodeCertFileNotFoundAtCertPath', {err}]);
          }

          return cbk(null, res.toString('base64'));
        });
      }],

      // Get macaroon from path if necessary
      getMacaroon: ['getFile', ({getFile}, cbk) => {
        if (!getFile.macaroon_path) {
          return cbk(null, getFile.macaroon);
        }

        return fs.getFile(getFile.macaroon_path, (err, res) => {
          if (!!err) {
            return cbk([400, 'SavedNodeMacaroonNotFoundAtPath', {err}]);
          }

          return cbk(null, res.toString('base64'));
        });
      }],

      // Final credentials
      credentials: [
        'getCert',
        'getFile',
        'getMacaroon',
        ({getCert, getFile, getMacaroon}, cbk) =>
      {
        if (!getMacaroon && !getFile.encrypted_macaroon) {
          return cbk([400, 'SavedNodeMissingMacaroonData']);
        }

        if (!!getFile.encrypted_macaroon && !getFile.encrypted_to) {
          return cbk([400, 'MissingEncryptToRecipientsInSavedCredentials']);
        }

        if (!getFile.socket) {
          return cbk([400, 'SavedNodeMissingSocket']);
        }

        return cbk(null, {
          node,
          credentials: {
            cert: getCert || undefined,
            encrypted_macaroon: getFile.encrypted_macaroon,
            encrypted_to: getFile.encrypted_to,
            macaroon: getMacaroon,
            socket: getFile.socket,
          },
        });
      }],
    },
    returnResult({reject, resolve, of: 'credentials'}, cbk));
  });
};
