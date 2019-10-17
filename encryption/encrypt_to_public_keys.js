const {spawn} = require('child_process');

const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const flatten = arr => [].concat(...arr);
const {isArray} = Array;

/** Encrypt a string using a spawned GPG

  {
    plain: <Plain Clear Text String>
    to: [<Encrypt To Recipient String>]
  }

  @returns via cbk or Promise
  {
    cipher: <Armored Encrypted Text String>
  }
*/
module.exports = ({plain, to}, cbk) => {
  return new Promise((reject, resolve) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!plain) {
          return cbk([400, 'ExpectedPlainTextToEncrypt']);
        }

        if (!isArray(to) || !to.length) {
          return cbk([400, 'ExpectedRecipientOfEncryptedData']);
        }

        return cbk();
      },

      // Encrypt plain text
      encrypt: ['validate', ({}, cbk) => {
        const datas = [];

        const recipients = to
          .map(n => n.replace(/\s/g, ''))
          .map(n => (['--recipient', n]));

        const encrypt = spawn('gpg', ['-ea'].concat(flatten(recipients)));

        encrypt.stdin.setEncoding('utf-8');

        encrypt.stdout.on('data', data => datas.push(data));

        encrypt.stdout.on('end', () => {
          return cbk(null, {
            cipher: Buffer.concat(datas).toString('utf8').trim(),
          });
        });

        encrypt.stdout.on('error', err => cbk([503, 'EncryptingErr', {err}]));

        encrypt.stdin.write(`${plain}\n`);

        encrypt.stdin.end();

        return;
      }],
    },
    returnResult({reject, resolve, of: 'encrypt'}, cbk));
  });
};
