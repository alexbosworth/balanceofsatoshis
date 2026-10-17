const {deepEqual} = require('node:assert').strict;
const EventEmitter = require('node:events');
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {idForTransaction} = require('@alexbosworth/blockchain');
const {transactionFromComponents} = require('@alexbosworth/blockchain');

const method = require('./../../chain/get_close_from_spend');

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

// Make an LND that responds to a spend registration
const makeLnd = ({emit, registrations}) => {
  return {
    chain: {
      registerSpendNtfn: args => {
        const stream = new EventEmitter();

        stream.cancel = () => {};

        if (!!registrations) {
          registrations.push(args.script.toString('hex'));
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

const makeArgs = overrides => {
  const args = {
    close_confirm_height: closeHeight,
    close_transaction_id: closeTxId,
    lnd: makeLnd({emit: emitSpend(closeTx)}),
    transaction_id: fundingTxId,
    transaction_vout: 0,
    transactions: [{id: fundingTxId, transaction: fundingTx}],
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({close_confirm_height: undefined}),
    description: 'A close height is required',
    error: [400, 'ExpectedCloseConfirmHeightToGetCloseFromSpend'],
  },
  {
    args: makeArgs({close_transaction_id: undefined}),
    description: 'A close tx id is required',
    error: [400, 'ExpectedCloseTransactionIdToGetCloseFromSpend'],
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is required',
    error: [400, 'ExpectedLndToGetCloseFromSpend'],
  },
  {
    args: makeArgs({transaction_id: undefined}),
    description: 'A funding tx id is required',
    error: [400, 'ExpectedFundingTransactionIdToGetCloseFromSpend'],
  },
  {
    args: makeArgs({transaction_vout: undefined}),
    description: 'A funding output index is required',
    error: [400, 'ExpectedFundingOutputIndexToGetCloseFromSpend'],
  },
  {
    args: makeArgs({transactions: undefined}),
    description: 'Wallet transactions are required',
    error: [400, 'ExpectedTransactionsToGetCloseFromSpend'],
  },
  {
    args: makeArgs({}),
    description: 'A close tx is found as the spend of the funding output',
    expected: {id: closeTxId, transaction: closeTx},
    registrations: [fundingScript],
  },
  {
    args: makeArgs({transactions: [{id: fundingTxId}]}),
    description: 'A spend is not looked up without the raw funding tx',
    expected: {},
    registrations: [],
  },
  {
    args: makeArgs({transaction_vout: 1}),
    description: 'A spend is not looked up without the funding output',
    expected: {},
    registrations: [],
  },
  {
    args: makeArgs({}),
    description: 'Nothing is returned when the lookup fails',
    emit: stream => stream.emit('error', {details: 'err'}),
    expected: {},
    registrations: [fundingScript],
  },
  {
    args: makeArgs({}),
    description: 'Nothing is returned when the spend is not found',
    emit: stream => stream.emit('end'),
    expected: {},
    registrations: [fundingScript],
  },
  {
    args: makeArgs({}),
    description: 'A spend that is not the close tx is not returned',
    emit: emitSpend(otherTx),
    expected: {},
    registrations: [fundingScript],
  },
];

tests.forEach(test_ => {
  const {args, description, emit, error, expected, registrations} = test_;

  return test(description, async () => {
    const registered = [];

    if (!!registrations) {
      args.lnd = makeLnd({
        emit: emit || emitSpend(closeTx),
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

    return;
  });
});
