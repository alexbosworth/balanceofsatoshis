const {test} = require('@alexbosworth/tap');
const {makeLnd} = require('mock-lnd');

const method = require('./../../balances/get_detailed_balance');
const {listChannelsResponse} = require('./../fixtures');

const tests = [
  {
    args: {},
    description: 'LND is required',
    error: [400, 'ExpectedAuthenticatedLndToGetDetailedBalance'],
  },
  {
    args: {lnd: makeLnd({})},
    description: 'Detailed balance is returned',
    expected: '7b226f6666636861696e5f62616c616e6365223a225c75303031625b326d302e30303030303030325c75303031625b32326d222c226f6e636861696e5f62616c616e6365223a225c75303031625b326d302e30303030303030315c75303031625b32326d222c226f6e636861696e5f766279746573223a3134347d',
  },
  {
    args: {
      lnd: makeLnd({
        getChannels: ({}, cbk) => cbk(null, {channels: []}),
        getUtxos: ({}, cbk) => cbk(null, {utxos: []}),
      }),
    },
    description: 'No balance is returned',
    expected: '7b7d',
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects}) => {
    if (!!error) {
      await rejects(method(args), error, 'Got expected error');
    } else {
      const res = await method(args);

      const encoded = Buffer.from(JSON.stringify(res)).toString('hex');

      equal(encoded, expected, 'Got expected result');
    }

    return end();
  });
});
