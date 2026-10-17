const {deepEqual} = require('node:assert').strict;
const EventEmitter = require('node:events');
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {idForTransaction} = require('@alexbosworth/blockchain');
const {numberAsCompactInt} = require('@alexbosworth/blockchain');
const {transactionFromComponents} = require('@alexbosworth/blockchain');

const method = require('./../../chain/get_close_transactions');

const blockHeaderByteLength = 80;
const closeHeight = 100;
const fundingScript = `0020${'01'.repeat(32)}`;

const makeTx = ({id, outputs}) => {
  return transactionFromComponents({
    outputs,
    inputs: [{id, script: '', vout: 0}],
    locktime: 0,
    version: 2,
  }).transaction;
};

const fundingTx = makeTx({
  id: Buffer.alloc(32).toString('hex'),
  outputs: [{script: fundingScript, tokens: 100000}],
});

const fundingTxId = idForTransaction({transaction: fundingTx}).id;

const closeTx = makeTx({
  id: fundingTxId,
  outputs: [{script: `0014${'02'.repeat(20)}`, tokens: 99000}],
});

const closeTxId = idForTransaction({transaction: closeTx}).id;

const otherTx = makeTx({
  id: fundingTxId,
  outputs: [{script: `0014${'03'.repeat(20)}`, tokens: 99000}],
});

const otherTxId = idForTransaction({transaction: otherTx}).id;

// Make a hex encoded block out of raw transactions
const makeBlock = txs => Buffer.concat([
  Buffer.alloc(blockHeaderByteLength),
  numberAsCompactInt({number: txs.length}).encoded,
  ...txs.map(tx => Buffer.from(tx, 'hex')),
]).toString('hex');

// By default the block at the close height has no close transactions in it
const emptyBlock = makeBlock([]);

// Make an LND that responds to a spend registration and returns blocks
const makeLnd = ({block, blocks, emit, getBlock, registrations}) => {
  return {
    blocks: {
      getBlock: ({block_hash}, cbk) => {
        if (!!blocks) {
          blocks.push(block_hash.toString('hex'));
        }

        // Exit early when the block lookup is overridden
        if (!!getBlock) {
          return getBlock({}, cbk);
        }

        return cbk(null, {raw_block: Buffer.from(block || emptyBlock, 'hex')});
      },
      getBlockHash: ({block_height}, cbk) => {
        return cbk(null, {block_hash: Buffer.alloc(32, block_height)});
      },
    },
    chain: {
      registerSpendNtfn: args => {
        const stream = new EventEmitter();

        stream.cancel = () => {};

        if (!!registrations) {
          registrations.push({
            height_hint: args.height_hint,
            script: args.script.toString('hex'),
          });
        }

        setImmediate(() => emit(stream));

        return stream;
      },
    },
  };
};

// Emit the spend of the funding output
const emitSpend = transaction => stream => stream.emit('data', {
  spend: {
    raw_spending_tx: Buffer.from(transaction, 'hex'),
    spending_height: closeHeight,
    spending_input_index: 0,
  },
});

const channel = {
  close_confirm_height: closeHeight,
  close_transaction_id: closeTxId,
  transaction_id: fundingTxId,
  transaction_vout: 0,
};

// Another channel that closed in the same block
const otherChannel = {
  close_confirm_height: closeHeight,
  close_transaction_id: otherTxId,
  transaction_id: Buffer.alloc(32, 2).toString('hex'),
  transaction_vout: 0,
};

const makeArgs = overrides => {
  const args = {
    channels: [channel],
    lnd: makeLnd({emit: emitSpend(closeTx)}),
    transactions: [{id: fundingTxId, transaction: fundingTx}],
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({channels: undefined}),
    description: 'Channels are required',
    error: [400, 'ExpectedChannelsToGetCloseTransactions'],
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is required',
    error: [400, 'ExpectedLndToGetCloseTransactions'],
  },
  {
    args: makeArgs({transactions: undefined}),
    description: 'Wallet transactions are required',
    error: [400, 'ExpectedTransactionsToGetCloseTransactions'],
  },
  {
    args: makeArgs({}),
    description: 'A close tx missing from the wallet is found',
    expected: {transactions: [{id: closeTxId, transaction: closeTx}]},
    registrations: [{height_hint: closeHeight, script: fundingScript}],
  },
  {
    args: makeArgs({
      transactions: [
        {id: closeTxId, transaction: closeTx},
        {id: fundingTxId, transaction: fundingTx},
      ],
    }),
    description: 'A close tx already in the wallet is not looked up',
    expected: {transactions: []},
    registrations: [],
  },
  {
    args: makeArgs({
      channels: [{...channel, close_confirm_height: undefined}],
    }),
    description: 'A close tx without a close height is not looked up',
    expected: {transactions: []},
    registrations: [],
  },
  {
    args: makeArgs({transactions: []}),
    description: 'A spend is not looked up without the funding tx',
    expected: {transactions: []},
    registrations: [],
  },
  {
    args: makeArgs({channels: [{...channel, transaction_vout: 1}]}),
    description: 'A spend is not looked up without the funding output',
    expected: {transactions: []},
    registrations: [],
  },
  {
    args: makeArgs({transactions: []}),
    block: makeBlock([otherTx, closeTx]),
    blocks: 1,
    description: 'A close tx is found in its block without the funding tx',
    expected: {transactions: [{id: closeTxId, transaction: closeTx}]},
    registrations: [],
  },
  {
    args: makeArgs({
      lnd: makeLnd({
        block: makeBlock([closeTx]),
        emit: stream => stream.emit('end'),
      }),
    }),
    description: 'Close tx is found in its block when the spend is not found',
    expected: {transactions: [{id: closeTxId, transaction: closeTx}]},
  },
  {
    args: makeArgs({channels: [channel, otherChannel], transactions: []}),
    block: makeBlock([otherTx, closeTx]),
    blocks: 1,
    description: 'Close txs in the same block are found with one block lookup',
    expected: {
      transactions: [
        {id: otherTxId, transaction: otherTx},
        {id: closeTxId, transaction: closeTx},
      ],
    },
    registrations: [],
  },
  {
    args: makeArgs({
      channels: [channel, {...otherChannel, close_confirm_height: 101}],
      transactions: [],
    }),
    block: makeBlock([closeTx]),
    blocks: 2,
    description: 'Close txs in different blocks are looked up separately',
    expected: {transactions: [{id: closeTxId, transaction: closeTx}]},
    registrations: [],
  },
  {
    args: makeArgs({
      lnd: makeLnd({
        emit: stream => stream.emit('end'),
        getBlock: ({}, cbk) => cbk({details: 'err'}),
      }),
    }),
    description: 'A close tx is not returned when the block lookup fails',
    expected: {transactions: []},
  },
  {
    args: makeArgs({
      lnd: makeLnd({emit: stream => stream.emit('error', {details: 'err'})}),
    }),
    description: 'A close tx is not returned when the lookup fails',
    expected: {transactions: []},
  },
  {
    args: makeArgs({lnd: makeLnd({emit: stream => stream.emit('end')})}),
    description: 'A close tx is not returned when the spend is not found',
    expected: {transactions: []},
  },
  {
    args: makeArgs({lnd: makeLnd({emit: emitSpend(otherTx)})}),
    description: 'A spend that is not the close tx is not returned',
    expected: {transactions: []},
  },
];

tests.forEach(test_ => {
  const {args, block, blocks, description, error, expected} = test_;
  const {registrations} = test_;

  return test(description, async () => {
    const lookedUp = [];
    const registered = [];

    if (!!registrations) {
      args.lnd = makeLnd({
        block,
        blocks: lookedUp,
        emit: emitSpend(closeTx),
        registrations: registered,
      });
    }

    if (!!error) {
      await rejects(method(args), error, 'Got expected error');
    } else {
      deepEqual(await method(args), expected, 'Got expected result');
    }

    if (!!registrations) {
      deepEqual(registered, registrations, 'Looked up expected spends');
    }

    if (blocks !== undefined) {
      deepEqual(lookedUp.length, blocks, 'Looked up expected blocks');
    }

    return;
  });
});
