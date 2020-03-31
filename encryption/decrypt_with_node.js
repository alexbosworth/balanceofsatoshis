const asyncAuto = require('async/auto');
const {decodeFirst} = require('cbor');
const {diffieHellmanComputeSecret} = require('ln-service');
const {getNode} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const decryptWithSecret = require('./decrypt_with_secret');

const hexAsBuf = hex => Buffer.from(hex, 'hex');
const {isArray} = Array;

/** Decrypt data from node

  {
    encrypted: <Encrypted Data Hex String>
    lnd: <Authenticated LND gRPC API Object>
  }

  @returns via cbk or Promise
  {
    message: <Message Object>
    with_alias: <With Node Public Key Hex String>
    with_public_key: <With Public Key Hex String>
  }
*/
module.exports = ({encrypted, lnd}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!encrypted) {
          return cbk([400, 'ExpectedEncryptedPayloadToDecryptData']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndToDecryptData']);
        }

        return cbk();
      },

      // Decode encrypted CBOR
      decode: ['validate', ({}, cbk) => {
        return decodeFirst(encrypted, (err, details) => {
          if (!!err) {
            return cbk([400, 'ExpectedCborEncodedEncryptedData', {err}]);
          }

          if (!details) {
            return cbk([400, 'ExpectedDecodedDetailsToDecryptWithNode']);
          }

          if (!details.settings) {
            return cbk([400, 'ExpectedEncryptionSettingsToDecryptWithNode']);
          }

          if (!isArray(details.settings.with)) {
            return cbk([400, 'ExpectedWithNodesPublicKeyToDecrypt']);
          }

          return cbk(null, details);
        });
      }],

      // Get node public key
      getPublicKey: ['decode', ({decode}, cbk) => {
        return getWalletInfo({lnd}, cbk);
      }],

      // Determine the foreign key if any
      foreignKey: ['decode', 'getPublicKey', ({decode, getPublicKey}, cbk) => {
        const keys = decode.settings.with;

        const foreignKey = keys.find(n => n !== getPublicKey.public_key);

        return cbk(null, foreignKey || getPublicKey.public_key);
      }],

      // Get details about the node
      getNode: ['foreignKey', ({foreignKey}, cbk) => {
        return getNode({
          lnd,
          is_omitting_channels: true,
          public_key: foreignKey,
        },
        (err, res) => {
          if (!!err) {
            return cbk(null, {public_key: foreignKey});
          }

          return cbk(null, {alias: res.alias, public_key: foreignKey});
        });
      }],

      // Derive the shared secret
      getSecret: ['foreignKey', ({foreignKey}, cbk) => {
        return diffieHellmanComputeSecret({
          lnd,
          partner_public_key: foreignKey,
        },
        cbk);
      }],

      // Decrypt the data
      decrypt: ['decode', 'getSecret', ({decode, getSecret}, cbk) => {
        return decryptWithSecret({
          encrypted: Buffer.from(decode.encrypted, 'hex'),
          iv: decode.iv,
          salt: decode.salt,
          secret: getSecret.secret,
          settings: {
            algorithm: decode.settings.algorithm,
            derivation: decode.settings.derivation,
            digest: decode.settings.digest,
            key_length: decode.settings.key_length,
          },
          tag: decode.tag,
        },
        cbk);
      }],

      // Cleartext
      clear: [
        'decode',
        'decrypt',
        'getNode',
        ({decode, decrypt, getNode}, cbk) =>
      {
        return cbk(null, {
          with_alias: getNode.alias || undefined,
          with_public_key: getNode.public_key,
          message: hexAsBuf(decrypt.plain).toString(decode.settings.encoding),
        });
      }],
    },
    returnResult({reject, resolve, of: 'clear'}, cbk));
  });
};
