const {equal} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {decodeFirstSync} = require('cbor');

const decryptWithSecret = require('./../../encryption/decrypt_with_secret');
const encryptToSecret = require('./../../encryption/encrypt_to_secret');

const bufferAsHex = buffer => buffer.toString('hex');
const hexAsBuffer = hex => Buffer.from(hex, 'hex');

const makeArgs = overrides => {
  const args = {
    plain: bufferAsHex(Buffer.alloc(1e5, 3)),
    secret: bufferAsHex(Buffer.alloc(32, 1)),
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({plain: undefined}),
    description: 'Data to encrypt is required',
    error: [400, 'ExpectedDataToEncryptToSecret'],
  },
  {
    args: makeArgs({secret: undefined}),
    description: 'A secret is required',
    error: [400, 'ExpectedSecretToEncryptToSecret'],
  },
  {
    args: makeArgs({}),
    description: 'Data encrypted to a secret is decrypted with the secret',
    expected: {plain: bufferAsHex(Buffer.alloc(1e5, 3))},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(encryptToSecret(args), error, 'Got expected error');
    } else {
      const {cipher} = await encryptToSecret(args);

      // The cipher is the CBOR encoded encryption
      const encryption = decodeFirstSync(hexAsBuffer(cipher));

      const {plain} = await decryptWithSecret({
        encrypted: encryption.encrypted,
        iv: encryption.iv,
        salt: encryption.salt,
        secret: args.secret,
        settings: encryption.settings,
        tag: encryption.tag,
      });

      equal(plain, expected.plain, 'Got the plain data back');
    }

    return;
  });
});
