const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const {stripVTControlCharacters} = require('node:util');
const test = require('node:test');

const {getDetailedBalance} = require('./../../balances');
const {listChannelsResponse} = require('./../fixtures');

const changeAddress = 'bc1qchangechangechangechangechangechange00';
const otherAddress = 'bc1qxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

// Amounts are styled when the terminal supports colors, so compare plain text
const plain = n => typeof n === 'string' ? stripVTControlCharacters(n) : n;

const withoutStyles = balance => {
  return Object.fromEntries(Object.entries(balance).map(([k, v]) => {
    return [k, plain(v)];
  }));
};

const makeUtxo = ({address, confirmations, tokens}) => {
  return {
    address: address || otherAddress,
    address_type: 'WITNESS_PUBKEY_HASH',
    amount_sat: String(tokens),
    confirmations: String(confirmations),
    outpoint: {
      output_index: 0,
      txid_str: Buffer.alloc(32).toString('hex'),
    },
    pk_script: '00',
  };
};

// An unconfirmed outgoing transaction that pays change to the change address
const outgoingTx = {
  amount: '-50000',
  block_hash: '',
  block_height: 0,
  dest_addresses: [changeAddress],
  num_confirmations: 0,
  previous_outpoints: [],
  time_stamp: '1',
  total_fees: '1',
  tx_hash: Buffer.alloc(32, 1).toString('hex'),
};

const makeLnd = ({err, transactions, utxos}) => {
  return {
    default: {
      getTransactions: ({}, cbk) => cbk(null, {
        transactions: transactions || [],
      }),
      listChannels: ({}, cbk) => cbk(err, listChannelsResponse),
      listUnspent: ({}, cbk) => cbk(null, {utxos: utxos || []}),
      pendingChannels: ({}, cbk) => cbk(null, {
        pending_closing_channels: [],
        pending_force_closing_channels: [],
        pending_open_channels: [],
        total_limbo_balance: '0',
        waiting_close_channels: [],
      }),
    },
    wallet: {
      listLeases: ({}, cbk) => cbk(null, {locked_utxos: []}),
      listUnspent: ({}, cbk) => cbk(null, {utxos: utxos || []}),
    },
  };
};

// A node with a confirmed UTXO and an unconfirmed change UTXO
const makeFundedLnd = () => makeLnd({
  transactions: [outgoingTx],
  utxos: [
    makeUtxo({confirmations: 1, tokens: 1e5}),
    makeUtxo({address: changeAddress, confirmations: 0, tokens: 2e5}),
  ],
});

const emptyBalance = {
  closing_balance: undefined,
  conflicted_pending: undefined,
  invalid_pending: undefined,
  offchain_balance: undefined,
  offchain_pending: undefined,
  onchain_confirmed: undefined,
  onchain_pending: undefined,
  onchain_vbytes: undefined,
  utxos_count: undefined,
};

const tests = [
  {
    args: {},
    description: 'An array of LNDs is required',
    error: [400, 'ExpectedAuthenticatedLndsToGetDetailedBalance'],
  },
  {
    args: {lnds: {}},
    description: 'LNDs must be an array',
    error: [400, 'ExpectedAuthenticatedLndsToGetDetailedBalance'],
  },
  {
    args: {lnds: [makeLnd({err: 'err'})]},
    description: 'An error getting node funds is passed back',
    error: [503, 'UnexpectedGetChannelsError', {err: 'err'}],
  },
  {
    args: {lnds: []},
    description: 'No LNDs results in an empty balance',
    expected: emptyBalance,
  },
  {
    args: {lnds: [makeLnd({})]},
    description: 'A node with only a channel has an offchain balance',
    expected: {...emptyBalance, offchain_balance: '0.00000002'},
  },
  {
    args: {lnds: [makeFundedLnd()]},
    description: 'Get detailed balance including pending chain funds',
    expected: {
      ...emptyBalance,
      offchain_balance: '0.00000002',
      onchain_confirmed: '0.00100000',
      onchain_pending: '0.00200000',
      onchain_vbytes: 189,
      utxos_count: 2,
    },
  },
  {
    args: {is_confirmed: true, lnds: [makeFundedLnd()]},
    description: 'Only confirmed UTXOs count towards the vbytes footprint',
    expected: {
      ...emptyBalance,
      offchain_balance: '0.00000002',
      onchain_confirmed: '0.00100000',
      onchain_pending: '0.00200000',
      onchain_vbytes: 122,
      utxos_count: 2,
    },
  },
  {
    args: {
      lnds: [
        makeFundedLnd(),
        makeLnd({utxos: [makeUtxo({confirmations: 1, tokens: 1e5})]}),
      ],
    },
    description: 'Detailed balances are summed across nodes',
    expected: {
      ...emptyBalance,
      offchain_balance: '0.00000004',
      onchain_confirmed: '0.00200000',
      onchain_pending: '0.00200000',
      onchain_vbytes: 311,
      utxos_count: 3,
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(getDetailedBalance(args), error, 'Got expected error');
    } else {
      const res = await getDetailedBalance(args);

      deepEqual(withoutStyles(res), expected, 'Got expected balance');
    }

    return;
  });
});
