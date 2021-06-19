const {test} = require('@alexbosworth/tap');

const {getDepositAddress} = require('./../../chain');

const tests = [
  {
    args: {},
    description: 'LND is required',
    error: [400, 'ExpectedAuthenticatedLndToGetDepositAddress'],
  },
  {
    args: {
      lnd: {default: {newAddress: ({}, cbk) => cbk(null, {address: 'addr'})}},
    },
    description: 'A chain address is returned',
    expected: {deposit_address: 'addr', deposit_qr: true},
  },
  {
    args: {
      lnd: {default: {newAddress: ({}, cbk) => cbk(null, {address: 'addr'})}},
      tokens: 1,
    },
    description: 'A chain address is returned',
    expected: {deposit_address: 'addr', deposit_qr: true},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects}) => {
    if (!!error) {
      rejects(getDepositAddress(args), error, 'Got expected error');
    } else {
      const res = await getDepositAddress(args);

      equal(res.deposit_address, expected.deposit_address, 'Got address');
      equal(!!res.deposit_qr, expected.deposit_qr, 'Got expected QR');
    }

    return end();
  });
});
