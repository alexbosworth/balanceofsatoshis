const {test} = require('@alexbosworth/tap');

const {decryptPayload} = require('./../../encryption');
const {encrypted} = require('./fixtures');
const {secret} = require('./fixtures');

const {parse} = JSON;

const tests = [
  {
    args: {},
    description: 'An encrypted payload is required',
    error: 'ExpectedEncryptedPayloadToDecrypt',
  },
  {
    args: {encrypted},
    description: 'A secret key is required',
    error: 'ExpectedDecryptionSecretKeyToDecrypt',
  },
  {
    args: {encrypted, secret: 'ff'},
    description: 'A valid secret key is required',
    error: 'FailedToDecryptCipherTextWithSecretKey',
  },
  {
    args: {
      secret,
      encrypted: Buffer.from(encrypted, 'base64').toString('hex'),
    },
    description: 'Paylaod is decrypted',
    expected: {
      pair: 'BTCUSD',
      price: 4004.14,
      timestamp: '2019-01-10T00:00:11.000Z',
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, throws}) => {
    if (!!error) {
      throws(() => decryptPayload(args), new Error(error), 'Got error');
    } else {
      const [{pair, price, timestamp}] = parse(decryptPayload(args).payload);

      equal(pair, expected.pair, 'Got expected pair');
      equal(price, expected.price, 'Got expectd price');
      equal(timestamp, expected.timestamp, 'Got expected timestamp');
    }

    return end();
  });
});
