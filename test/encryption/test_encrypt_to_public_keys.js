const {test} = require('@alexbosworth/tap');

const {encryptToPublicKeys} = require('./../../encryption');

const makeSpawn = args => {
  return () => {
    return {
      stdout: {on: (event, cbk) => {
        if (!!args.is_error && event === 'error') {
          return cbk('err');
        }

        if (!args.is_error && event === 'data') {
          return cbk(Buffer.from('cipher'));
        }

        if (!args.is_error && event === 'end') {
          return cbk();
        }

        return;
      }},
      stdin: {end: () => {}, setEncoding: () => {}, write: () => {}},
    };
  };
};

const tests = [
  {
    args: {},
    description: 'A plain text to encrypt required',
    error: [400, 'ExpectedPlainTextToEncrypt'],
  },
  {
    args: {plain: 'plain'},
    description: 'A spawn function to encrypt required',
    error: [400, 'ExpectedSpawnFunctionToEncryptToPublicKeys'],
  },
  {
    args: {plain: 'plain', spawn: makeSpawn({})},
    description: 'A set of recipients to encrypt to required',
    error: [400, 'ExpectedRecipientOfEncryptedData'],
  },
  {
    args: {plain: 'plain', spawn: makeSpawn({}), to: []},
    description: 'A recipient to encrypt to required',
    error: [400, 'ExpectedRecipientOfEncryptedData'],
  },
  {
    args: {plain: 'plain', spawn: makeSpawn({is_error: true}), to: ['to']},
    description: 'Encryption error passed back',
    error: [503, 'EncryptingErr', {err: 'err'}],
  },
  {
    args: {plain: 'plain', spawn: makeSpawn({}), to: ['to']},
    description: 'Cipher text is returned from plain text',
    expected: {cipher: 'cipher'},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects}) => {
    if (!!error) {
      rejects(encryptToPublicKeys(args), error, 'Got expected error');
    } else {
      const {cipher} = await encryptToPublicKeys(args);

      equal(cipher, expected.cipher, 'Got expected cipher output');
    }

    return end();
  });
});
