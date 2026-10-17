const {deepEqual} = require('node:assert').strict;
const test = require('node:test');

const {idForTransaction} = require('@alexbosworth/blockchain');
const {transactionFromComponents} = require('@alexbosworth/blockchain');

const method = require('./../../chain/resolution_fee');

const closeTxId = Buffer.alloc(32, 1).toString('hex');
const otherCloseTxId = Buffer.alloc(32, 2).toString('hex');
const unknownTxId = Buffer.alloc(32, 9).toString('hex');

const makeTx = ({inputs, outputs}) => {
  return transactionFromComponents({
    outputs,
    inputs: inputs.map(input => ({
      id: input.id,
      script: '',
      vout: input.vout,
      witness: input.witness,
    })),
    locktime: 0,
    version: 2,
  }).transaction;
};

const idOf = transaction => idForTransaction({transaction}).id;

// Close transactions with a 50,000 balance output and a 5,000 HTLC output
const closeTx = makeTx({
  inputs: [{id: Buffer.alloc(32).toString('hex'), vout: 0}],
  outputs: [
    {script: `0014${'01'.repeat(20)}`, tokens: 50000},
    {script: `0020${'07'.repeat(32)}`, tokens: 5000},
  ],
});

const otherCloseTx = makeTx({
  inputs: [{id: Buffer.alloc(32).toString('hex'), vout: 1}],
  outputs: [
    {script: `0014${'02'.repeat(20)}`, tokens: 50000},
    {script: `0020${'08'.repeat(32)}`, tokens: 5000},
  ],
});

// A wallet transaction with a 10,000 output used to fund fees
const walletTx = makeTx({
  inputs: [{id: Buffer.alloc(32).toString('hex'), vout: 2}],
  outputs: [{script: `0014${'03'.repeat(20)}`, tokens: 10000}],
});

const walletTxId = idOf(walletTx);

// A sweep of only the close output, paying a 500 fee
const sweepTx = makeTx({
  inputs: [{id: closeTxId, vout: 0}],
  outputs: [{script: `0014${'04'.repeat(20)}`, tokens: 49500}],
});

const sweepTxId = idOf(sweepTx);

// A sweep of the close output funded by a wallet output, paying a 500 fee
const fundedSweepTx = makeTx({
  inputs: [{id: closeTxId, vout: 0}, {id: walletTxId, vout: 0}],
  outputs: [{script: `0014${'04'.repeat(20)}`, tokens: 59500}],
});

const fundedSweepTxId = idOf(fundedSweepTx);

// A sweep shared with another channel: the own input has a bigger witness
const sharedSweepTx = makeTx({
  inputs: [
    {id: closeTxId, vout: 0, witness: ['aa'.repeat(71), 'bb'.repeat(50)]},
    {id: otherCloseTxId, vout: 0, witness: ['cc'.repeat(71), 'dd'.repeat(33)]},
  ],
  outputs: [{script: `0014${'04'.repeat(20)}`, tokens: 99000}],
});

const sharedSweepTxId = idOf(sharedSweepTx);

// A second level tx shared between channels pays a 400 fee for two HTLCs
const secondLevelTx = makeTx({
  inputs: [{id: closeTxId, vout: 1}, {id: otherCloseTxId, vout: 1}],
  outputs: [
    {script: `0020${'05'.repeat(32)}`, tokens: 4800},
    {script: `0020${'06'.repeat(32)}`, tokens: 4800},
  ],
});

const secondLevelTxId = idOf(secondLevelTx);

// A sweep of both second level outputs with equal inputs pays a 200 fee
const secondStageTx = makeTx({
  inputs: [{id: secondLevelTxId, vout: 0}, {id: secondLevelTxId, vout: 1}],
  outputs: [{script: `0014${'04'.repeat(20)}`, tokens: 9400}],
});

const secondStageTxId = idOf(secondStageTx);

// Own input weight: 164 + 124 = 288, other input weight: 164 + 107 = 271
const sharedFeeShare = Math.round(1000 * 288 / (288 + 271));

const makeArgs = overrides => {
  const args = {
    contract_outputs: [{id: closeTxId}, {id: secondLevelTxId, vout: 0}],
    id: sweepTxId,
    other_contract_outputs: [
      {id: otherCloseTxId},
      {id: secondLevelTxId, vout: 1},
    ],
    transactions: [
      {id: closeTxId, transaction: closeTx},
      {id: otherCloseTxId, transaction: otherCloseTx},
      {id: walletTxId, transaction: walletTx},
      {id: sweepTxId, transaction: sweepTx},
      {id: fundedSweepTxId, transaction: fundedSweepTx},
      {id: sharedSweepTxId, transaction: sharedSweepTx},
      {id: secondLevelTxId, transaction: secondLevelTx},
      {id: secondStageTxId, transaction: secondStageTx},
    ],
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({id: unknownTxId}),
    description: 'The fee is unknown when the resolving tx is not known',
    expected: {},
  },
  {
    args: makeArgs({transactions: [{id: sweepTxId}]}),
    description: 'The fee is unknown when the resolving tx raw is not known',
    expected: {},
  },
  {
    args: makeArgs({contract_outputs: [{id: unknownTxId}]}),
    description: 'The fee is unknown when the tx spends no channel outputs',
    expected: {},
  },
  {
    args: makeArgs({
      transactions: [{id: sweepTxId, transaction: sweepTx}],
    }),
    description: 'The fee is unknown when the total fee is not known',
    expected: {},
  },
  {
    args: makeArgs({}),
    description: 'The whole fee is attributed when the tx is not shared',
    expected: {fee: 500},
  },
  {
    args: makeArgs({id: fundedSweepTxId}),
    description: 'Fee funding inputs do not reduce the attributed fee',
    expected: {fee: 500},
  },
  {
    args: makeArgs({id: sharedSweepTxId}),
    description: 'A shared fee is pro-rated by the weight of own inputs',
    expected: {fee: sharedFeeShare},
  },
  {
    args: makeArgs({id: sharedSweepTxId, other_contract_outputs: []}),
    description: 'Unrecognized inputs are treated as fee funding inputs',
    expected: {fee: 1000},
  },
  {
    args: makeArgs({id: secondLevelTxId}),
    description: 'A second level tx shared between channels is pro-rated',
    expected: {fee: 200},
  },
  {
    args: makeArgs({id: secondStageTxId}),
    description: 'Only own outputs of a shared second level tx are own inputs',
    expected: {fee: 100},
  },
  {
    args: makeArgs({
      contract_outputs: [{id: closeTxId}, {id: secondLevelTxId, vout: 1}],
      id: secondStageTxId,
      other_contract_outputs: [{id: secondLevelTxId, vout: 0}],
    }),
    description: 'The other channel gets its own share of the shared sweep',
    expected: {fee: 100},
  },
  {
    args: makeArgs({
      transactions: [
        {id: closeTxId, transaction: closeTx},
        {fee: 400, id: sweepTxId, transaction: sweepTx},
      ],
    }),
    description: 'A wallet reported fee is used as the total fee',
    expected: {fee: 400},
  },
];

tests.forEach(({args, description, expected}) => {
  return test(description, () => {
    deepEqual(method(args), expected, 'Got expected resolution fee');

    return;
  });
});
