const {equal} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {getUtxos} = require('./../../chain');

const utxo = {
  address: 'address',
  address_type: 'NESTED_PUBKEY_HASH',
  amount_sat: '1',
  confirmations: '1',
  outpoint: {bytes: Buffer.alloc(1), output_index: 0, txid_str: '00'},
  pk_script: '00',
};

const makeLnd = ({listUnspent}) => {
  const unspent = ({}, cbk) => cbk(null, {utxos: [utxo]});

  const lnd = {
    default: {
      closedChannels: ({}, cbk) => cbk(null, {channels: []}),
      getTransactions: ({}, cbk) => cbk(null, {transactions: []}),
      listChannels: ({}, cbk) => cbk(null, {channels: []}),
      listUnspent: listUnspent || unspent,
      pendingChannels: ({}, cbk) => cbk(null, {
        pending_force_closing_channels: [],
        pending_open_channels: [],
        waiting_close_channels: [],
      }),
    },
    wallet: {listUnspent: listUnspent || unspent},
  };

  return lnd;
};

const tests = [
  {
    args: {},
    description: 'LND is required',
    error: [400, 'ExpectedLndObjectToGetUtxos'],
  },
  {
    args: {lnd: makeLnd({})},
    description: 'Utxos are returned',
    expected: {
      address: 'address',
      amount: '\x1B[2m0.00000001\x1B[22m',
      confirmations: 1,
      is_unconfirmed: undefined,
      outpoint: '00:0',
      related_description: undefined,
      related_channels: undefined,
    },
  },
  {
    args: {count_below: 1, lnd: makeLnd({})},
    description: 'No count below',
    expected: {count: 0},
  },
  {
    args: {
      count_below: 5,
      is_confirmed: true,
      lnd: makeLnd({
        listUnspent: ({}, cbk) => cbk(null, {
          utxos: [{
            address: 'address',
            address_type: 'NESTED_PUBKEY_HASH',
            amount_sat: '2',
            confirmations: '1',
            outpoint: {
              bytes: Buffer.alloc(1),
              output_index: 0,
              txid_str: '00',
            },
            pk_script: '00',
          }],
        }),
      }),
      min_tokens: 1,
    },
    description: 'A count below a target is returned',
    expected: {count: 4},
  },
  {
    args: {
      is_count: 1,
      lnd: makeLnd({
        listUnspent: ({}, cbk) => cbk(null, {
          utxos: [{
            address: 'address',
            address_type: 'NESTED_PUBKEY_HASH',
            amount_sat: '2',
            confirmations: '1',
            outpoint: {
              bytes: Buffer.alloc(1),
              output_index: 0,
              txid_str: '00',
            },
            pk_script: '00',
          }],
        }),
      }),
      min_tokens: 1,
    },
    description: 'Just a count is returned',
    expected: {count: 1},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(getUtxos(args), error, 'Got expected error');
    } else if (!args.count_below && !args.is_count) {
      const {utxos} = await getUtxos(args);

      const [utxo, none] = utxos;

      equal(none, undefined, 'Only one UTXO returned');
      equal(utxo.address, expected.address, 'Got expected address');
      equal(utxo.confirmations, expected.confirmations, 'Got confs');
      equal(utxo.outpoint, expected.outpoint, 'Got outpoint');
      equal(utxo.amount, expected.amount, 'Got expected tokens');
      equal(utxo.is_unconfirmed, expected.is_unconfirmed, 'Got unconf');
      equal(utxo.related_description, expected.related_description, 'Desc');
      equal(utxo.related_channels, expected.related_channels, 'Channels');
    } else {
      const count = await getUtxos(args);

      equal(count, expected.count, 'Got expected count');
    }

    return;
  });
});
