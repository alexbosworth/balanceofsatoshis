const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {idForTransaction} = require('@alexbosworth/blockchain');
const {numberAsCompactInt} = require('@alexbosworth/blockchain');
const {transactionFromComponents} = require('@alexbosworth/blockchain');

const method = require('./../../chain/get_block_transactions');

const blockHeaderByteLength = 80;
const height = 100;

const makeTx = ({id, tokens}) => {
  return transactionFromComponents({
    inputs: [{id, script: '', vout: 0}],
    locktime: 0,
    outputs: [{tokens, script: `0014${'02'.repeat(20)}`}],
    version: 2,
  }).transaction;
};

// Make a hex encoded block out of raw transactions
const makeBlock = txs => Buffer.concat([
  Buffer.alloc(blockHeaderByteLength),
  numberAsCompactInt({number: txs.length}).encoded,
  ...txs.map(tx => Buffer.from(tx, 'hex')),
]).toString('hex');

const tx = makeTx({id: Buffer.alloc(32).toString('hex'), tokens: 1000});
const otherTx = makeTx({id: Buffer.alloc(32, 1).toString('hex'), tokens: 2});

const raw_block = Buffer.from(makeBlock([tx]), 'hex');
const txId = idForTransaction({transaction: tx}).id;
const otherTxId = idForTransaction({transaction: otherTx}).id;
const unknownTxId = Buffer.alloc(32, 9).toString('hex');

// Make an LND that returns a block for a height
const makeLnd = ({block, getBlock}) => {
  return {
    blocks: {
      getBlock: getBlock || (({}, cbk) => cbk(null, {raw_block: block})),
      getBlockHash: ({}, cbk) => cbk(null, {block_hash: Buffer.alloc(32)}),
    },
  };
};

const makeArgs = overrides => {
  const args = {
    height,
    ids: [txId],
    lnd: makeLnd({block: Buffer.from(makeBlock([otherTx, tx]), 'hex')}),
    timeout: 1000,
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({height: undefined}),
    description: 'A block height is required',
    error: [400, 'ExpectedBlockHeightToGetBlockTransactions'],
  },
  {
    args: makeArgs({ids: undefined}),
    description: 'Transaction ids are required',
    error: [400, 'ExpectedTransactionIdsToGetBlockTransactions'],
  },
  {
    args: makeArgs({ids: []}),
    description: 'At least one transaction id is required',
    error: [400, 'ExpectedTransactionIdsToGetBlockTransactions'],
  },
  {
    args: makeArgs({ids: ['id']}),
    description: 'Transaction ids must be hex encoded hashes',
    error: [400, 'ExpectedTransactionIdHexStringsToGetBlockTxs'],
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is required',
    error: [400, 'ExpectedLndToGetBlockTransactions'],
  },
  {
    args: makeArgs({
      lnd: makeLnd({getBlock: ({}, cbk) => cbk({details: 'err'})}),
    }),
    description: 'Errors getting the block are passed back',
    error: [503, 'UnexpectedErrorWhenGettingChainBlock'],
  },
  {
    args: makeArgs({lnd: makeLnd({block: Buffer.alloc(100)})}),
    description: 'Errors parsing the block are passed back',
    error: [503, 'UnexpectedErrorParsingBlockTransactions'],
  },
  {
    args: makeArgs({}),
    description: 'A transaction is found in the block',
    expected: {transactions: [{id: txId, transaction: tx}]},
  },
  {
    args: makeArgs({ids: [otherTxId, txId]}),
    description: 'Multiple transactions are found in block order',
    expected: {
      transactions: [
        {id: otherTxId, transaction: otherTx},
        {id: txId, transaction: tx},
      ],
    },
  },
  {
    args: makeArgs({ids: [unknownTxId]}),
    description: 'A transaction not in the block is not returned',
    expected: {transactions: []},
  },
  {
    args: makeArgs({lnd: makeLnd({getBlock: () => {}}), timeout: 10}),
    description: 'No transactions are returned when the block takes too long',
    expected: {transactions: []},
  },
  {
    args: makeArgs({
      lnd: makeLnd({
        getBlock: ({}, cbk) => setTimeout(() => cbk(null, {raw_block}), 20),
      }),
      timeout: 10,
    }),
    description: 'A block arriving after the timeout is ignored',
    expected: {transactions: []},
    wait: 30,
  },
];

tests.forEach(({args, description, error, expected, wait}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(method(args), error, 'Got expected error');
    } else {
      deepEqual(await method(args), expected, 'Got expected result');
    }

    // Wait for a late response to make sure it is ignored
    if (!!wait) {
      await new Promise(resolve => setTimeout(resolve, wait));
    }

    return;
  });
});
