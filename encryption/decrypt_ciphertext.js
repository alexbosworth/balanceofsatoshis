const {spawn} = require('child_process');

const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

/** Decrypt ciphertext that has been encrypted to GPG keys

  {
    cipher: <Encrypted Text String>
  }

  @returns via cbk or Promise
  {
    clear: <Clear Text String>
  }
*/
module.exports = ({cipher}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!cipher) {
          return cbk([400, 'ExpectedCiphertextToDecrypt']);
        }

        return cbk();
      },

      // Decrypt the ciphertext
      decrypt: ['validate', ({}, cbk) => {
        const datas = [];
        const decrypt = spawn('gpg', ['-d']);

        decrypt.stdin.setEncoding('utf-8');

        decrypt.stdout.on('data', data => datas.push(data));
        decrypt.stdout.on('error', err => cbk([503, 'DecryptionFail', {err}]));

        decrypt.stdout.on('end', () => {
          if (!datas.length) {
            return cbk([503, 'FailedToDecrypt']);
          }

          return cbk(null, {
            clear: Buffer.concat(datas).toString('utf8').trim(),
          });
        });

        decrypt.stdin.write(`${cipher}`);

        decrypt.stdin.end();

        return;
      }],
    },
    returnResult({reject, resolve, of: 'decrypt'}, cbk));
  });
};
