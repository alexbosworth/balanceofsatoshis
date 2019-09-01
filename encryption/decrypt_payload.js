const {AES} = require('crypto-js');
const {enc} = require('crypto-js');
const {lib} = require('crypto-js');
const {mode} = require('crypto-js');
const {pad} = require('crypto-js');

const {decrypt} = AES;
const {Hex} = enc;
const padding = pad.NoPadding;
const takeCipherWords = words => words.slice(4);
const takeIvWords = words => words.slice(0, 4);
const trim = (hex, index) => hex.slice(0, index === 0 ? undefined : index);
const {WordArray} = lib;
const zeroIndex = h => h.split('').slice().reverse().findIndex(n => n !== '0');

/** Decrypt encrypted payload

  {
    encrypted: <Encrypted Data Hex String>
    secret: <Secret Key String>
  }

  @throws
  <Error>

  @returns
  {
    payload: <UTF8 Payload String>
  }
*/
module.exports = ({encrypted, secret}) => {
  if (!encrypted) {
    throw new Error('ExpectedEncryptedPayloadToDecrypt');
  }

  if (!secret) {
    throw new Error('ExpectedDecryptionSecretKeyToDecrypt');
  }

  const [key, payload] = [secret, encrypted].map(Hex.parse);

  const hex = WordArray.create(takeCipherWords(payload.words)).toString(Hex);
  const iv = WordArray.create(takeIvWords(payload.words));

  const ciphertext = Hex.parse(trim(hex, hex.length - zeroIndex(hex)));

  try {
    const clear = decrypt({ciphertext}, key, {iv, padding, mode: mode.CFB});

    return {payload: clear.toString(enc.Utf8)};
  } catch (err) {
    throw new Error('FailedToDecryptCipherTextWithSecretKey');
  }
};
