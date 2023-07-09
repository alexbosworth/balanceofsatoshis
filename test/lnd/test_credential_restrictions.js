const {deepEqual} = require('node:assert').strict;
const test = require('node:test');
const {throws} = require('node:assert').strict;

const method = require('./../../lnd/credential_restrictions');

const tests = [
  {
    args: {},
    description: 'No restrictions results in no allow elements',
    expected: {},
  },
  {
    args: {is_nospend: true},
    description: 'No spend results in nospend permissions',
    expected: {
      allow: {
        methods: [],
        permissions: [
          'address:read',
          'address:write',
          'info:read',
          'info:write',
          'invoices:read',
          'invoices:write',
          'macaroon:read',
          'message:read',
          'offchain:read',
          'onchain:read',
          'peers:read',
          'peers:write',
          'signer:read',
        ],
      },
    },
  },
  {
    args: {is_readonly: true},
    description: 'Readonly results in read permissions',
    expected: {
      allow: {
        methods: [],
        permissions: [
          'address:read',
          'info:read',
          'invoices:read',
          'macaroon:read',
          'message:read',
          'offchain:read',
          'onchain:read',
          'peers:read',
          'signer:read',
        ],
      },
    },
  },
  {
    args: {methods: ['getWalletInfo']},
    description: 'Readonly results in read permissions',
    expected: {allow: {methods: ['getWalletInfo'], permissions: []}},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, (t, end) => {
    if (!!error) {
      throws(() => method(args), new Error(error), 'Got expected error');
    } else {
      const res = method(args);

      deepEqual(res, expected, 'Got expected result');
    }

    return end();
  });
});
