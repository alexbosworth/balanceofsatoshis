const asyncAuto = require('async/auto');
const {encode} = require('cbor');
const {returnResult} = require('asyncjs-util');

const lndCredentials = require('./lnd_credentials');
const {pemAsDer} = require('./../encryption');

/** Get exported credentials

  {
    ask: <Inquirer Function> ({message, name, type}, cbk) => {}
    is_cleartext: <Export Clear Credential Components Bool>
    logger: <Winston Logger Object> ({info}) => ()
    [node]: <Node Name String>
  }

  @returns via cbk or Promise
  {
    [cleartext]: {
      cert: <TLS Cert File Base64 Encoded String>
      macaroon: <Macaroon Authentication File Base64 Encoded String>
      socket: <External Host and Port String>
    }
    [credentials]: <Encrypted Node Credentials CBOR Hex String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.ask) {
          return cbk([400, 'ExpectedPromptFunctionToGetCredentials']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToGetCredentials']);
        }

        return cbk();
      },

      // Ask for the transfer key
      key: ['validate', ({}, cbk) => {
        if (!!args.is_cleartext) {
          return cbk();
        }

        const enterTransferKey = {
          message: 'Enter a transfer public key:',
          name: 'key',
          type: 'input',
        };

        return args.ask(enterTransferKey, ({key}) => cbk(null, key));
      }],

      // Get credentials encrypted to transfer key
      getCredentials: ['key', ({key}, cbk) => {
        if (!args.is_cleartext && !key) {
          return cbk([400, 'ExpectedCredentialsTransferKeyFromNodesAdd']);
        }

        return lndCredentials({
          key,
          logger: args.logger,
          node: args.node,
        },
        cbk);
      }],

      // Packaged credentials
      credentials: ['getCredentials', ({getCredentials}, cbk) => {
        if (!!args.is_cleartext) {
          return cbk(null, {
            cert: getCredentials.cert,
            macaroon: getCredentials.macaroon,
            socket: getCredentials.external_socket || getCredentials.socket,
          });
        }

        const encryptedMacaroon = getCredentials.encrypted_macaroon;
        const externalSocket = getCredentials.external_socket;

        const pem = Buffer.from(getCredentials.cert, 'base64').toString();

        const credentials = {
          cert: Buffer.from(pemAsDer({pem}).der, 'hex'),
          encrypted_macaroon: Buffer.from(encryptedMacaroon, 'base64'),
          socket: externalSocket || getCredentials.socket || undefined,
        };

        return cbk(null, {
          exported_credentials: encode(credentials).toString('hex'),
        });
      }],
    },
    returnResult({reject, resolve, of: 'credentials'}, cbk));
  });
};
