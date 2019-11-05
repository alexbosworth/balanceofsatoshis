const asyncAuto = require('async/auto');
const {encode} = require('cbor');
const {returnResult} = require('asyncjs-util');

const lndCredentials = require('./lnd_credentials');
const {pemAsDer} = require('./../encryption');

/** Get exported credentials

  {
    ask: <Inquirer Function> ({message, name, type}, cbk) => {}
    logger: <Winston Logger Object> ({info}) => ()
    [node]: <Node Name String>
  }

  @returns via cbk or Promise
  {
    credentials: <Encrypted Node Credentials CBOR Hex String>
  }
*/
module.exports = ({ask, logger, node}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!ask) {
          return cbk([400, 'ExpectedPromptFunctionToGetCredentials']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedLoggerToGetCredentials']);
        }

        return cbk();
      },

      // Ask for the transfer key
      key: ['validate', ({}, cbk) => {
        const enterTransferKey = {
          message: 'Enter a transfer public key:',
          name: 'key',
          type: 'input',
        };

        return ask(enterTransferKey, ({key}) => cbk(null, key));
      }],

      // Get credentials encrypted to transfer key
      getCredentials: ['key', ({key}, cbk) => {
        return lndCredentials({key, logger, node}, cbk);
      }],

      // Packaged credentials
      credentials: ['getCredentials', ({getCredentials}, cbk) => {
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
