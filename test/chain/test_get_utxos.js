const {deepEqual} = require('node:assert').strict;
const {equal} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {formatTokens} = require('ln-sync');
const {idForTransaction} = require('@alexbosworth/blockchain');
const moment = require('moment');
const {transactionFromComponents} = require('@alexbosworth/blockchain');

const {getNodeInfoResponse} = require('./../fixtures');
const {getUtxos} = require('./../../chain');
const {listChannelsResponse} = require('./../fixtures');

const futureExpiration = '4102444800';
const lockId = Buffer.alloc(32, 1);
const pastExpiration = '1';
const peerKey = listChannelsResponse.channels[0].remote_pubkey;

const utxo = {
  address: 'address',
  address_type: 'NESTED_PUBKEY_HASH',
  amount_sat: '1',
  confirmations: '1',
  outpoint: {bytes: Buffer.alloc(1), output_index: 0, txid_str: '00'},
  pk_script: '00',
};

// A wallet transaction that has a locked output
const lockedTx = transactionFromComponents({
  inputs: [{
    id: Buffer.alloc(32, 2).toString('hex'),
    script: '',
    sequence: 0,
    vout: 0,
  }],
  locktime: 0,
  outputs: [{script: `0014${'03'.repeat(20)}`, tokens: 5000}],
  version: 2,
}).transaction;

const lockedTxId = idForTransaction({transaction: lockedTx}).id;
const noRawTxId = Buffer.alloc(32, 4).toString('hex');
const relatedTxId = Buffer.alloc(32, 6).toString('hex');
const unknownTxId = Buffer.alloc(32, 5).toString('hex');

const makeRpcTx = ({id, label, raw}) => ({
  amount: '5000',
  block_hash: '',
  block_height: 0,
  dest_addresses: [],
  label,
  num_confirmations: 0,
  previous_outpoints: [],
  raw_tx_hex: raw,
  time_stamp: '1',
  total_fees: '0',
  tx_hash: id,
});

const makeLock = ({expiration, id, vout}) => ({
  expiration: expiration || futureExpiration,
  id: lockId,
  outpoint: {output_index: vout || 0, txid_str: id},
  pk_script: Buffer.alloc(22, 3),
  value: '5000',
});

const makeLnd = ({channels, getNodeInfo, leases, listUnspent, txs}) => {
  const unspent = ({}, cbk) => cbk(null, {utxos: [utxo]});

  const lnd = {
    default: {
      closedChannels: ({}, cbk) => cbk(null, {channels: []}),
      getChanInfo: ({}, cbk) => cbk('err'),
      getNodeInfo: getNodeInfo || (({}, cbk) => cbk('err')),
      getTransactions: ({}, cbk) => cbk(null, {transactions: txs || []}),
      listChannels: ({}, cbk) => cbk(null, {channels: channels || []}),
      listUnspent: listUnspent || unspent,
      pendingChannels: ({}, cbk) => cbk(null, {
        pending_force_closing_channels: [],
        pending_open_channels: [],
        waiting_close_channels: [],
      }),
    },
    wallet: {listUnspent: listUnspent || unspent},
  };

  if (!!leases) {
    lnd.wallet.listLeases = ({}, cbk) => cbk(null, {locked_utxos: leases});
  }

  return lnd;
};

// LND with a channel related to a UTXO and locked UTXOs in various states
const makeLockedLnd = ({getNodeInfo}) => makeLnd({
  getNodeInfo,
  channels: listChannelsResponse.channels.map(channel => ({
    ...channel,
    channel_point: `${relatedTxId}:0`,
  })),
  leases: [
    makeLock({expiration: pastExpiration, id: lockedTxId}),
    makeLock({id: unknownTxId}),
    makeLock({id: noRawTxId}),
    makeLock({id: lockedTxId, vout: 1}),
    makeLock({id: lockedTxId}),
  ],
  listUnspent: ({}, cbk) => cbk(null, {
    utxos: [{...utxo, outpoint: {output_index: 0, txid_str: relatedTxId}}],
  }),
  txs: [
    makeRpcTx({id: relatedTxId}),
    makeRpcTx({id: noRawTxId}),
    makeRpcTx({id: lockedTxId, label: 'label', raw: lockedTx}),
  ],
});

const expectedUnspent = ({related}) => [
  {
    address: 'address',
    amount: formatTokens({tokens: 1}).display,
    confirmations: 1,
    is_unconfirmed: undefined,
    lock_expires_at: undefined,
    locked: undefined,
    outpoint: `${relatedTxId}:0`,
    related_channels: [`opened_channel with ${related}`],
    related_description: undefined,
  },
  {
    address: undefined,
    amount: formatTokens({tokens: 5000}).display,
    confirmations: undefined,
    is_unconfirmed: true,
    lock_expires_at: moment(Number(futureExpiration) * 1e3).calendar(),
    locked: lockId.toString('hex'),
    outpoint: `${lockedTxId}:0`,
    related_channels: undefined,
    related_description: 'label',
  },
];

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
      utxos: [{
        address: 'address',
        amount: formatTokens({tokens: 1}).display,
        confirmations: 1,
        is_unconfirmed: undefined,
        lock_expires_at: undefined,
        locked: undefined,
        outpoint: '00:0',
        related_channels: undefined,
        related_description: undefined,
      }],
    },
  },
  {
    args: {
      lnd: makeLockedLnd({
        getNodeInfo: ({}, cbk) => {
          return cbk(null, {...getNodeInfoResponse, channels: []});
        },
      }),
    },
    description: 'Locked utxos and related channels with aliases are returned',
    expected: {utxos: expectedUnspent({related: 'alias'})},
  },
  {
    args: {lnd: makeLockedLnd({})},
    description: 'Related channels without aliases use the public key',
    expected: {utxos: expectedUnspent({related: peerKey})},
  },
  {
    args: {count_below: 1, lnd: makeLnd({})},
    description: 'No count below',
    expected: 0,
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
    expected: 4,
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
    expected: 1,
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(getUtxos(args), error, 'Got expected error');
    } else {
      deepEqual(await getUtxos(args), expected, 'Got expected result');
    }

    return;
  });
});
