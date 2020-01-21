const {createCipheriv} = require('crypto');
const {randomBytes} = require('crypto');
const {scrypt} = require('crypto');

const asyncAuto = require('async/auto');
const {encode} = require('cbor');
const {returnResult} = require('asyncjs-util');

const algorithm = 'aes-256-gcm';
const cbor = n => encode(n).toString('hex');
const derivation = 'scrypt';
const digest = 'sha512';
const fromHex = n => Buffer.from(n, 'hex');
const ivByteLength = 16;
const keyLength = 32;
const saltByteLength = 32;
const uniq = arr => Array.from(new Set(arr));

/** Encrypt data to a secret

  {
    [encoding]: <Data Encoding Format String>
    [from]: <Data is From Public Key Hex String>
    plain: <Data To Encrypt Hex String>
    secret: <Encryption Secret Hex String>
    [to]: <Data is To Public Key Hex String>
  }

  @returns via cbk or Promise
  {
    cipher: <CBOR Encoded Encrypted Hex String>
  }
*/
module.exports = ({encoding, from, plain, secret, to}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!plain) {
          return cbk([400, 'ExectedDataToEncryptToSecret']);
        }

        if (!secret) {
          return cbk([400, 'ExpectedSecretToEncryptToSecret']);
        }

        return cbk();
      },

      // Generate salt
      salt: ['validate', ({}, cbk) => cbk(null, randomBytes(saltByteLength))],

      // Encryption settings
      settings: ['validate', ({}, cbk) => {
        return cbk(null, {
          algorithm,
          derivation,
          digest,
          encoding,
          key_length: keyLength,
          with: uniq([from, to]),
        });
      }],

      // Generate a derivative key
      key: ['salt', ({salt}, cbk) => {
        return scrypt(fromHex(secret), salt, keyLength, (err, derivedKey) => {
          if (!!err) {
            return cbk([503, 'UnexpectedErrorGeneratingDerivativeKey', {err}]);
          }

          return cbk(null, derivedKey);
        });
      }],

      // Encrypt to derivative key
      encrypt: ['key', 'salt', 'settings', ({key, salt, settings}, cbk) => {
        const iv = randomBytes(ivByteLength);

        try {
          createCipheriv(algorithm, key, iv);
        } catch (err) {
          return cbk([500, 'FailedToCreateCipherWhenEncryptingToSecret']);
        }

        const cipher = createCipheriv(algorithm, key, iv);

        const updated = [cipher.update(fromHex(plain)), cipher.final()];

        const encrypted = Buffer.concat(updated);
        const tag = cipher.getAuthTag();

        return cbk(null, {cipher: cbor({encrypted, iv, salt, settings, tag})});
      }],
    },
    returnResult({reject, resolve, of: 'encrypt'}, cbk));
  });
};
