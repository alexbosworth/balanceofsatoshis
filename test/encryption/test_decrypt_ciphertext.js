const {equal} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {decryptCiphertext} = require('./../../encryption');

const makeSpawn = args => {
  return () => {
    return {
      stdout: {on: (event, cbk) => {
        if (!!args.is_error && event === 'error') {
          return cbk('err');
        }

        if (!args.is_error && !args.is_no_data && event === 'data') {
          return cbk(Buffer.from('clear'));
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
    description: 'A cipher text to decrypt required',
    error: [400, 'ExpectedCiphertextToDecrypt'],
  },
  {
    args: {cipher: 'cipher'},
    description: 'A spawn function to decrypt required',
    error: [400, 'ExpectedSpawnFunctionToDecryptCiphertext'],
  },
  {
    args: {cipher: 'cipher', spawn: makeSpawn({is_error: true})},
    description: 'A decryption fail error is passed back',
    error: [503, 'DecryptionFail', {err: 'err'}],
  },
  {
    args: {cipher: 'cipher', spawn: makeSpawn({is_no_data: true})},
    description: 'A decryption fail error is passed back on no data returned',
    error: [503, 'FailedToDecrypt'],
  },
  {
    args: {cipher: 'cipher', spawn: makeSpawn({})},
    description: 'A clear text result is returned',
    expected: {clear: 'clear'},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(decryptCiphertext(args), error, 'Got expected error');
    } else {
      const {clear} = await decryptCiphertext(args);

      equal(clear, expected.clear, 'Got expected clear text output');
    }

    return;
  });
});
