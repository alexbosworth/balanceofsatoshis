const {createDecipheriv} = require('crypto');
const {scrypt} = require('crypto');

const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const algorithm = 'aes-256-gcm';
const bufAsHex = n => n.toString('hex');
const derivation = 'scrypt';
const digest = 'sha512';
const fromHex = n => Buffer.from(n, 'hex');
const keyLength = 32;

/** Decrypt encrypted data with a secret

  {
    encrypted: <Encrypted Data Buffer Object>
    iv: <Initialization Vector Buffer Object>
    salt: <Salt Buffer Object>
    secret: <Secret Hex String>
    settings: {
      algorithm: <Algorithm String>
      derivation: <Key Derivation Type String>
      digest: <Digest String>
      key_length: <Key Length Number>
    }
    tag: <Auth Tag Buffer Object>
  }

  @returns via cbk or Promise
  {
    plain: <Decrypted Data Hex String>
  }
*/
module.exports = ({encrypted, iv, salt, secret, settings, tag}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!Buffer.isBuffer(encrypted)) {
          return cbk([400, 'ExpectedEncryptedDataToDecryptWithSecret']);
        }

        if (!Buffer.isBuffer(iv)) {
          return cbk([400, 'ExpectedIvToDecryptWithSecret']);
        }

        if (!Buffer.isBuffer(salt)) {
          return cbk([400, 'ExpectedSaltToDecryptWithSecret']);
        }

        if (!secret) {
          return cbk([400, 'ExpectedSecretToDecryptWithSecret']);
        }

        if (!settings) {
          return cbk([400, 'ExpectedSettingsToDecryptWithSecret']);
        }

        if (settings.algorithm !== algorithm) {
          return cbk([400, 'ExpectedKnownAlgorithmToDecryptWithSecret']);
        }

        if (settings.derivation !== derivation) {
          return cbk([400, 'ExpectedKnownKeyDerivationToDecryptWithSecret']);
        }

        if (settings.digest !== digest) {
          return cbk([400, 'ExpectedKnownDigestToDecryptWithSecret']);
        }

        if (settings.key_length !== keyLength) {
          return cbk([400, 'ExpectedKnownKeyLengthToDecryptWithSecret']);
        }

        if (!tag) {
          return cbk([400, 'ExpectedAuthTagToDecryptWithSecret']);
        }

        return cbk();
      },

      // Derive the key from the secret
      key: ['validate', ({}, cbk) => {
        const keyLength = settings.key_length;

        return scrypt(fromHex(secret), salt, keyLength, (err, derivedKey) => {
          if (!!err) {
            return cbk([503, 'UnexpectedErrorGettingDerivativeKey', {err}]);
          }

          return cbk(null, derivedKey);
        });
      }],

      // Decrypt data with the derived key
      decrypt: ['key', ({key}, cbk) => {
        const decipher = createDecipheriv(settings.algorithm, key, iv);

        decipher.setAuthTag(tag);

        try {
          const elements = [decipher.update(encrypted), decipher.final()];

          return cbk(null, {plain: bufAsHex(Buffer.concat(elements))});
        } catch (err) {
          return cbk([503, 'FailedToDecryptMessage', {err}]);
        }
      }],
    },
    returnResult({reject, resolve, of: 'decrypt'}, cbk));
  });
};
