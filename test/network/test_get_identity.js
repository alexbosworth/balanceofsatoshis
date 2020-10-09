const {test} = require('tap');

const {getIdentity} = require('./../../network');
const {getInfoResponse} = require('./../fixtures');

const getInfoRes = () => JSON.parse(JSON.stringify(getInfoResponse));

const tests = [
  {
    args: {},
    description: 'Getting identity public key requires LND',
    error: [400, 'ExpectedAuthenticatedLndToGetIdentityKey'],
  },
  {
    args: {
      lnd: {
        wallet: {
          deriveKey: ({}, cbk) => cbk(null, {raw_key_bytes: Buffer.alloc(1)}),
        },
      },
    },
    description: 'Get identity key via derivation',
    expected: {public_key: '00'},
  },
  {
    args: {
      lnd: {
        default: {
          getInfo: ({}, cbk) => cbk(null, getInfoRes()),
        },
      },
    },
    description: 'Get identity key via info',
    expected: {
      public_key: '020000000000000000000000000000000000000000000000000000000000000000',
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({deepIs, end, equal, rejects}) => {
    if (!!error) {
      await rejects(getIdentity(args), error, 'Got expected error');
    } else {
      const identity = await getIdentity(args);

      deepIs(identity, expected, 'Got expected result');
    }

    return end();
  });
});
