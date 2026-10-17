const {deepEqual} = require('node:assert').strict;
const test = require('node:test');

const {idForTransaction} = require('@alexbosworth/blockchain');
const {transactionFromComponents} = require('@alexbosworth/blockchain');

const method = require('./../../chain/transaction_fee');

const makeTx = ({inputs, outputs}) => {
  return transactionFromComponents({
    outputs,
    inputs: inputs.map(({id, vout}) => ({id, vout, script: ''})),
    locktime: 0,
    version: 2,
  }).transaction;
};

// A transaction that creates two outputs
const fundingTx = makeTx({
  inputs: [{id: Buffer.alloc(32).toString('hex'), vout: 0}],
  outputs: [
    {script: `0014${'01'.repeat(20)}`, tokens: 60000},
    {script: `0014${'02'.repeat(20)}`, tokens: 40000},
  ],
});

const fundingTxId = idForTransaction({transaction: fundingTx}).id;

// A transaction that spends both outputs and pays a 1,000 fee
const spendTx = makeTx({
  inputs: [{id: fundingTxId, vout: 0}, {id: fundingTxId, vout: 1}],
  outputs: [{script: `0014${'03'.repeat(20)}`, tokens: 99000}],
});

// A transaction that spends an output index that does not exist
const badSpendTx = makeTx({
  inputs: [{id: fundingTxId, vout: 2}],
  outputs: [{script: `0014${'03'.repeat(20)}`, tokens: 1000}],
});

const makeArgs = overrides => {
  const args = {
    transaction: spendTx,
    transactions: [{id: fundingTxId, transaction: fundingTx}],
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({fee: 300}),
    description: 'A fee reported by the wallet is used',
    expected: {fee: 300},
  },
  {
    args: makeArgs({}),
    description: 'The fee is the spent value less the output value',
    expected: {fee: 1000},
  },
  {
    args: makeArgs({transactions: []}),
    description: 'The fee is unknown when a spent output is not known',
    expected: {},
  },
  {
    args: makeArgs({transactions: [{id: fundingTxId}]}),
    description: 'The fee is unknown when a spent tx is not known in raw form',
    expected: {},
  },
  {
    args: makeArgs({transaction: badSpendTx}),
    description: 'The fee is unknown when a spent output is not found',
    expected: {},
  },
];

tests.forEach(({args, description, expected}) => {
  return test(description, () => {
    deepEqual(method(args), expected, 'Got expected transaction fee');

    return;
  });
});
