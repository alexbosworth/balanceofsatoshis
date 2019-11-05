const {join} = require('path');
const {homedir} = require('os');

const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const {home} = require('./constants');

const credentials = 'credentials.json';
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
      cert: <Base64 or Hex Serialized LND TLS Cert>
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

        return cbk();
      },

      // Get credentials
      getCredentials: ['validate', ({}, cbk) => {
        const path = join(...[homedir(), home, node, credentials]);

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

          if (!credentials.cert) {
            return cbk([400, 'SavedNodeMissingCertData']);
          }

          if (!credentials.macaroon && !credentials.encrypted_macaroon) {
            return cbk([400, 'SavedNodeMissingMacaroonData']);
          }

          if (!!credentials.encrypted_macaroon && !credentials.encrypted_to) {
            return cbk([400, 'MissingEncryptToRecipientsInSavedCredentials']);
          }

          if (!credentials.socket) {
            return cbk([400, 'SavedNodeMissingSocket']);
          }

          return cbk(null, {
            node,
            credentials: {
              cert: credentials.cert,
              encrypted_macaroon: credentials.encrypted_macaroon,
              encrypted_to: credentials.encrypted_to,
              macaroon: credentials.macaroon,
              socket: credentials.socket,
            },
          });
        });
      }],
    },
    returnResult({reject, resolve, of: 'getCredentials'}, cbk));
  });
};
