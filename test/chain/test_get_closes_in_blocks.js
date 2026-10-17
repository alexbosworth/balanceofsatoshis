const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {idForTransaction} = require('@alexbosworth/blockchain');
const {numberAsCompactInt} = require('@alexbosworth/blockchain');
const {transactionFromComponents} = require('@alexbosworth/blockchain');

const method = require('./../../chain/get_closes_in_blocks');

const blockHeaderByteLength = 80;
const closeHeight = 100;

const makeTx = ({id, outputs}) => {
  return transactionFromComponents({
    outputs,
    inputs: [{id, script: '', vout: 0}],
    locktime: 0,
    version: 2,
  }).transaction;
};

const closeTx = makeTx({
  id: Buffer.alloc(32, 1).toString('hex'),
  outputs: [{script: `0014${'02'.repeat(20)}`, tokens: 99000}],
});

const otherTx = makeTx({
  id: Buffer.alloc(32, 2).toString('hex'),
  outputs: [{script: `0014${'03'.repeat(20)}`, tokens: 99000}],
});

const closeTxId = idForTransaction({transaction: closeTx}).id;
const otherTxId = idForTransaction({transaction: otherTx}).id;

// Make a hex encoded block out of raw transactions
const makeBlock = txs => Buffer.concat([
  Buffer.alloc(blockHeaderByteLength),
  numberAsCompactInt({number: txs.length}).encoded,
  ...txs.map(tx => Buffer.from(tx, 'hex')),
]).toString('hex');

// Make an LND that returns the same block for any height
const makeLnd = ({block, blocks, err}) => {
  return {
    blocks: {
      getBlock: ({}, cbk) => {
        blocks.push(block);

        // Exit early when the block lookup fails
        if (!!err) {
          return cbk(err);
        }

        return cbk(null, {raw_block: Buffer.from(block, 'hex')});
      },
      getBlockHash: ({}, cbk) => cbk(null, {block_hash: Buffer.alloc(32)}),
    },
  };
};

const channel = {
  close_confirm_height: closeHeight,
  close_transaction_id: closeTxId,
};

const otherChannel = {
  close_confirm_height: closeHeight,
  close_transaction_id: otherTxId,
};

const tests = [
  {
    args: {lnd: {}},
    description: 'Channels are required',
    error: [400, 'ExpectedChannelsToGetClosesInBlocks'],
  },
  {
    args: {channels: []},
    description: 'LND is required',
    error: [400, 'ExpectedLndToGetClosesInBlocks'],
  },
  {
    args: {channels: []},
    blocks: 0,
    description: 'No blocks are looked up without channels',
    expected: {transactions: []},
  },
  {
    args: {channels: [channel, otherChannel]},
    block: makeBlock([otherTx, closeTx]),
    blocks: 1,
    description: 'Close txs in the same block are found with one block lookup',
    expected: {
      transactions: [
        {id: otherTxId, transaction: otherTx},
        {id: closeTxId, transaction: closeTx},
      ],
    },
  },
  {
    args: {channels: [channel, {...otherChannel, close_confirm_height: 101}]},
    block: makeBlock([closeTx]),
    blocks: 2,
    description: 'Close txs in different blocks are looked up separately',
    expected: {transactions: [{id: closeTxId, transaction: closeTx}]},
  },
  {
    args: {channels: [channel]},
    block: makeBlock([closeTx]),
    blocks: 1,
    description: 'Close txs are not returned when the block lookup fails',
    err: {details: 'err'},
    expected: {transactions: []},
  },
];

tests.forEach(test_ => {
  const {args, block, blocks, description, err, error, expected} = test_;

  return test(description, async () => {
    const lookedUp = [];

    if (!error) {
      args.lnd = makeLnd({block, err, blocks: lookedUp});
    }

    if (!!error) {
      await rejects(method(args), error, 'Got expected error');
    } else {
      deepEqual(await method(args), expected, 'Got expected result');
    }

    if (blocks !== undefined) {
      deepEqual(lookedUp.length, blocks, 'Looked up expected blocks');
    }

    return;
  });
});
