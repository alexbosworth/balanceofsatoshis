const {test} = require('@alexbosworth/tap');

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
  return test(description, async ({end, strictSame, throws}) => {
    if (!!error) {
      throws(() => method(args), new Error(error), 'Got expected error');
    } else {
      const res = method(args);

      strictSame(res, expected, 'Got expected result');
    }

    return end();
  });
});
