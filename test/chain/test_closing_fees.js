const {deepEqual} = require('node:assert').strict;
const test = require('node:test');

const {idForTransaction} = require('@alexbosworth/blockchain');
const {transactionFromComponents} = require('@alexbosworth/blockchain');

const method = require('./../../chain/closing_fees');

const anchorVout = 2;
const capacity = 100000;
const fundingTxId = Buffer.alloc(32).toString('hex');
const otherCloseTxId = Buffer.alloc(32, 8).toString('hex');
const peerTxId = Buffer.alloc(32, 9).toString('hex');
const simpleCloseSequence = 0xfffffffd;

const makeTx = ({inputs, outputs}) => {
  return transactionFromComponents({
    outputs,
    inputs: inputs.map(input => ({
      id: input.id,
      script: '',
      sequence: input.sequence || 0,
      vout: input.vout,
    })),
    locktime: 0,
    version: 2,
  }).transaction;
};

const idOf = transaction => idForTransaction({transaction}).id;

// The close transaction pays out 99,000 of the 100,000 channel capacity
const closeTx = makeTx({
  inputs: [{id: fundingTxId, vout: 0}],
  outputs: [
    {script: `0014${'03'.repeat(20)}`, tokens: 60000},
    {script: `0014${'04'.repeat(20)}`, tokens: 39000},
  ],
});

const closeTxId = idOf(closeTx);

// A simple close signals RBF on the input spending the channel funds
const simpleCloseTx = makeTx({
  inputs: [{id: fundingTxId, sequence: simpleCloseSequence, vout: 0}],
  outputs: [
    {script: `0014${'03'.repeat(20)}`, tokens: 60000},
    {script: `0014${'04'.repeat(20)}`, tokens: 39000},
  ],
});

// The commitment pays out 98,000: a balance, an HTLC and two anchors
const commitTx = makeTx({
  inputs: [{id: fundingTxId, vout: 0}],
  outputs: [
    {script: `0020${'05'.repeat(32)}`, tokens: 92340},
    {script: `0020${'06'.repeat(32)}`, tokens: 5000},
    {script: `0020${'07'.repeat(32)}`, tokens: 330},
    {script: `0020${'08'.repeat(32)}`, tokens: 330},
  ],
});

const commitTxId = idOf(commitTx);

// Another channel's close transaction with a 50,000 balance output
const otherCloseTx = makeTx({
  inputs: [{id: Buffer.alloc(32, 7).toString('hex'), vout: 0}],
  outputs: [{script: `0020${'09'.repeat(32)}`, tokens: 50000}],
});

// A wallet transaction with a 10,000 output used to fund fees
const walletTx = makeTx({
  inputs: [{id: Buffer.alloc(32, 6).toString('hex'), vout: 0}],
  outputs: [{script: `0014${'0a'.repeat(20)}`, tokens: 10000}],
});

const walletTxId = idOf(walletTx);

// The sweep of the balance pays a 500 fee
const sweepTx = makeTx({
  inputs: [{id: commitTxId, vout: 0}],
  outputs: [{script: `0014${'0b'.repeat(20)}`, tokens: 91840}],
});

const sweepTxId = idOf(sweepTx);

// A sweep of the balance shared with another channel pays a 1,000 fee
const sharedSweepTx = makeTx({
  inputs: [{id: commitTxId, vout: 0}, {id: otherCloseTxId, vout: 0}],
  outputs: [{script: `0014${'0b'.repeat(20)}`, tokens: 141340}],
});

const sharedSweepTxId = idOf(sharedSweepTx);

// The anchor sweep is funded by a wallet output and pays a 500 fee
const anchorSweepTx = makeTx({
  inputs: [{id: commitTxId, vout: anchorVout}, {id: walletTxId, vout: 0}],
  outputs: [{script: `0014${'0c'.repeat(20)}`, tokens: 9830}],
});

const anchorSweepTxId = idOf(anchorSweepTx);

// A direct sweep of the HTLC output pays a 300 fee
const htlcSweepTx = makeTx({
  inputs: [{id: commitTxId, vout: 1}],
  outputs: [{script: `0014${'0d'.repeat(20)}`, tokens: 4700}],
});

const htlcSweepTxId = idOf(htlcSweepTx);

// A second level transaction spends the HTLC output and pays a 200 fee
const secondLevelTx = makeTx({
  inputs: [{id: commitTxId, vout: 1}],
  outputs: [{script: `0020${'0e'.repeat(32)}`, tokens: 4800}],
});

const secondLevelTxId = idOf(secondLevelTx);

// The sweep of the second level output pays a 200 fee
const secondStageTx = makeTx({
  inputs: [{id: secondLevelTxId, vout: 0}],
  outputs: [{script: `0014${'0f'.repeat(20)}`, tokens: 4600}],
});

const secondStageTxId = idOf(secondStageTx);

// A sweep of both the balance and the HTLC output pays a 600 fee
const combinedSweepTx = makeTx({
  inputs: [{id: commitTxId, vout: 0}, {id: commitTxId, vout: 1}],
  outputs: [{script: `0014${'0b'.repeat(20)}`, tokens: 96740}],
});

const combinedSweepTxId = idOf(combinedSweepTx);

const forceTransactions = [
  {id: commitTxId, transaction: commitTx},
  {id: otherCloseTxId, transaction: otherCloseTx},
  {id: walletTxId, transaction: walletTx},
  {id: sweepTxId, transaction: sweepTx},
  {id: sharedSweepTxId, transaction: sharedSweepTx},
  {id: anchorSweepTxId, transaction: anchorSweepTx},
  {id: htlcSweepTxId, transaction: htlcSweepTx},
  {id: secondLevelTxId, transaction: secondLevelTx},
  {id: secondStageTxId, transaction: secondStageTx},
  {id: combinedSweepTxId, transaction: combinedSweepTx},
];

const makePayment = overrides => {
  const payment = {
    is_outgoing: false,
    is_paid: false,
    is_pending: false,
    is_refunded: false,
    spent_by: htlcSweepTxId,
    tokens: 5000,
    transaction_id: commitTxId,
    transaction_vout: 1,
  };

  Object.keys(overrides).forEach(k => payment[k] = overrides[k]);

  return payment;
};

const makeArgs = overrides => {
  const args = {
    capacity,
    close_payments: [],
    close_transaction_id: closeTxId,
    is_cooperative_close: true,
    is_partner_closed: false,
    is_partner_initiated: false,
    other_contract_outputs: [{id: otherCloseTxId}],
    transactions: [{id: closeTxId, transaction: closeTx}],
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

// Force close args where the commitment fee was paid and the balance swept
const makeForceArgs = overrides => {
  return makeArgs({
    close_balance_spent_by: sweepTxId,
    close_transaction_id: commitTxId,
    is_cooperative_close: false,
    transactions: forceTransactions,
    ...overrides,
  });
};

const tests = [
  {
    args: makeArgs({}),
    description: 'Closing fees are capacity less the close tx outputs',
    expected: {fees: 1000},
  },
  {
    args: makeArgs({is_partner_closed: true, is_partner_initiated: true}),
    description: 'No fees are paid when the peer opened and closed',
    expected: {fees: 0},
  },
  {
    args: makeArgs({
      is_cooperative_close: false,
      is_partner_initiated: undefined,
    }),
    description: 'Fees are unknown when the opener is unknown',
    expected: {},
  },
  {
    args: makeArgs({capacity: undefined}),
    description: 'Fees are unknown when the capacity is unknown',
    expected: {},
  },
  {
    args: makeArgs({transactions: [{id: closeTxId}]}),
    description: 'Fees are unknown when the paid for close tx is unknown',
    expected: {},
  },
  {
    args: makeArgs({is_partner_closed: true}),
    description: 'Legacy close fees are paid by the opener',
    expected: {fees: 1000},
  },
  {
    args: makeArgs({
      is_partner_closed: true,
      transactions: [{id: closeTxId, transaction: simpleCloseTx}],
    }),
    description: 'Simple close fees are paid by the peer when the peer closes',
    expected: {fees: 0},
  },
  {
    args: makeArgs({
      is_partner_initiated: true,
      transactions: [{id: closeTxId, transaction: simpleCloseTx}],
    }),
    description: 'Simple close fees are paid by the closer and not the opener',
    expected: {fees: 1000},
  },
  {
    args: makeArgs({is_partner_initiated: true, transactions: []}),
    description: 'Fees are unknown when the close protocol is unknown',
    expected: {},
  },
  {
    args: makeForceArgs({}),
    description: 'Force close fees include the balance sweep fee',
    expected: {fees: 2500},
  },
  {
    args: makeForceArgs({is_partner_initiated: true}),
    description: 'Peer opened force close fees are the balance sweep fee',
    expected: {fees: 500},
  },
  {
    args: makeForceArgs({
      transactions: [
        {id: commitTxId, transaction: commitTx},
        {fee: 300, id: sweepTxId, transaction: sweepTx},
      ],
    }),
    description: 'Balance sweep fees reported by the wallet are used',
    expected: {fees: 2300},
  },
  {
    args: makeForceArgs({
      transactions: [{id: commitTxId, transaction: commitTx}],
    }),
    description: 'Fees are unknown when the balance sweep is unknown',
    expected: {},
  },
  {
    args: makeForceArgs({close_balance_spent_by: sharedSweepTxId}),
    description: 'Shared sweep fees are pro-rated to the channel',
    expected: {fees: 2500},
  },
  {
    args: makeForceArgs({
      close_balance_spent_by: sharedSweepTxId,
      transactions: forceTransactions.filter(n => n.id !== otherCloseTxId),
    }),
    description: 'Fees are unknown when a shared sweep input is unknown',
    expected: {},
  },
  {
    args: makeForceArgs({
      anchor_is_confirmed: true,
      anchor_spent_by: anchorSweepTxId,
      anchor_vout: anchorVout,
    }),
    description: 'Anchor sweep fees funded by the wallet are included',
    expected: {fees: 3000},
  },
  {
    args: makeForceArgs({anchor_vout: anchorVout}),
    description: 'A lost anchor is counted as a fee',
    expected: {fees: 2830},
  },
  {
    args: makeForceArgs({
      anchor_vout: anchorVout,
      is_partner_initiated: true,
      transactions: [{fee: 500, id: sweepTxId, transaction: sweepTx}],
    }),
    description: 'Fees are unknown when a lost anchor value is unknown',
    expected: {},
  },
  {
    args: makeForceArgs({anchor_is_pending: true, anchor_vout: anchorVout}),
    description: 'Fees are unknown when the anchor sweep is pending',
    expected: {},
  },
  {
    args: makeForceArgs({
      close_payments: [
        makePayment({is_pending: true, spent_by: secondLevelTxId}),
      ],
    }),
    description: 'Fees are unknown while an HTLC resolution is pending',
    expected: {},
  },
  {
    args: makeForceArgs({
      close_payments: [makePayment({is_outgoing: true, is_refunded: true})],
    }),
    description: 'Timed out outgoing HTLC sweep fees are included',
    expected: {fees: 2800},
  },
  {
    args: makeForceArgs({close_payments: [makePayment({is_paid: true})]}),
    description: 'Claimed incoming HTLC sweep fees are included',
    expected: {fees: 2800},
  },
  {
    args: makeForceArgs({
      close_payments: [
        makePayment({is_outgoing: true, is_paid: true, spent_by: peerTxId}),
      ],
    }),
    description: 'Outgoing HTLCs claimed by the peer cost nothing',
    expected: {fees: 2500},
  },
  {
    args: makeForceArgs({
      close_payments: [makePayment({is_refunded: true, spent_by: peerTxId})],
    }),
    description: 'Incoming HTLCs timed out by the peer cost nothing',
    expected: {fees: 2500},
  },
  {
    args: makeForceArgs({
      close_payments: [makePayment({spent_by: undefined})],
    }),
    description: 'HTLCs that were not spent cost nothing',
    expected: {fees: 2500},
  },
  {
    args: makeForceArgs({
      close_payments: [makePayment({is_paid: true, spent_by: peerTxId})],
    }),
    description: 'Fees are unknown when an own HTLC sweep is not known',
    expected: {},
  },
  {
    args: makeForceArgs({
      close_payments: [
        makePayment({is_pending: true, spent_by: secondLevelTxId}),
        makePayment({
          is_paid: true,
          spent_by: secondStageTxId,
          tokens: 4800,
          transaction_id: secondLevelTxId,
          transaction_vout: 0,
        }),
      ],
    }),
    description: 'Two stage HTLC fees include both stages',
    expected: {fees: 2900},
  },
  {
    args: makeForceArgs({
      close_balance_spent_by: combinedSweepTxId,
      close_payments: [
        makePayment({is_paid: true, spent_by: combinedSweepTxId}),
      ],
    }),
    description: 'A sweep resolving multiple outputs is only counted once',
    expected: {fees: 2600},
  },
];

tests.forEach(({args, description, expected}) => {
  return test(description, () => {
    deepEqual(method(args), expected, 'Got expected closing fees');

    return;
  });
});
