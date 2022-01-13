const {test} = require('@alexbosworth/tap');

const detailedBalances = require('./../../balances/detailed_balances');

const tests = [
  {
    args: {
      channels: [
        {
          commit_transaction_fee: 1,
          is_partner_initiated: true,
          local_balance: 2,
          pending_payments: [{is_outgoing: true, tokens: 3}],
        },
        {
          commit_transaction_fee: 4,
          is_partner_initiated: false,
          local_balance: 5,
          pending_payments: [{is_outgoing: false, tokens: 6}],
        },
      ],
      locked: [{
        tokens: 1,
      }],
      pending: [
        {
          is_closing: true,
          local_balance: 2,
          recovered_tokens: 1,
        },
        {
          is_opening: true,
          is_partner_initiated: true,
          local_balance: 0,
          transaction_fee: 1,
        },
        {
          is_opening: true,
          is_partner_initiated: true,
          local_balance: 2,
          pending_payments: [{is_outgoing: true, tokens: 3}],
          transaction_fee: 1,
        },
        {
          is_opening: false,
          is_partner_initiated: false,
          local_balance: 2,
          pending_payments: [{is_outgoing: true, tokens: 3}],
          transaction_fee: 1,
        },
        {
          is_opening: true,
          is_partner_initiated: false,
          local_balance: 5,
          pending_payments: [{is_outgoing: false, tokens: 6}],
        },
        {
          is_opening: true,
          is_partner_initiated: false,
          local_balance: 7,
          pending_payments: [{is_outgoing: true, tokens: 8}],
          transaction_fee: 9,
        },
      ],
      transactions: [
        {
          is_confirmed: false,
          is_outgoing: true,
          output_addresses: ['change-address'],
        },
      ],
      utxos: [
        {
          address: 'address',
          address_format: 'np2wpkh',
          confirmation_count: 1,
          tokens: 1,
        },
        {
          address: 'change-address',
          address_format: 'p2wpkh',
          confirmation_count: 0,
          tokens: 2,
        },
        {
          address: 'address2',
          address_format: 'p2wpkh',
          confirmation_count: 0,
          tokens: 2,
        },
      ],
    },
    description: 'Balance totals are calculated',
    expected: {
      closing_balance: 1,
      conflicted_pending: 0,
      invalid_pending: 0,
      offchain_balance: 14,
      offchain_pending: 35,
      onchain_balance: 4,
      onchain_vbytes: 211,
    },
  },
  {
    args: {channels: [], locked: [], pending: [], transactions: [], utxos: []},
    description: 'Balance totals are calculated when there are no funds',
    expected: {
      closing_balance: 0,
      conflicted_pending: 0,
      invalid_pending: 0,
      offchain_balance: 0,
      offchain_pending: 0,
      onchain_balance: 0,
      onchain_vbytes: 0,
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, ({end, equal, strictSame, throws}) => {
    if (!!error) {
      throws(() => detailedBalances(args), new Error(error));

      return end();
    }

    const balances = detailedBalances(args);

    strictSame(balances, expected, 'Got expected balances');

    return end();
  });
});
