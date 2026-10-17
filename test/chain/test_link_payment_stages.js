const {deepEqual} = require('node:assert').strict;
const test = require('node:test');

const {idForTransaction} = require('@alexbosworth/blockchain');
const {transactionFromComponents} = require('@alexbosworth/blockchain');

const method = require('./../../chain/link_payment_stages');

const commitTxId = Buffer.alloc(32, 1).toString('hex');
const firstSweepTxId = Buffer.alloc(32, 2).toString('hex');
const secondSweepTxId = Buffer.alloc(32, 3).toString('hex');
const walletTxId = Buffer.alloc(32, 4).toString('hex');

// A second level tx spending two HTLCs, paired by index, and a fee input
const secondLevelTx = transactionFromComponents({
  inputs: [
    {id: commitTxId, script: '', vout: 3},
    {id: commitTxId, script: '', vout: 2},
    {id: walletTxId, script: '', vout: 0},
  ],
  locktime: 0,
  outputs: [
    {script: `0020${'05'.repeat(32)}`, tokens: 7000},
    {script: `0020${'06'.repeat(32)}`, tokens: 5000},
    {script: `0014${'07'.repeat(20)}`, tokens: 1000},
  ],
  version: 2,
}).transaction;

const secondLevelTxId = idForTransaction({transaction: secondLevelTx}).id;

const makePayment = overrides => {
  const payment = {
    is_outgoing: false,
    is_paid: false,
    is_pending: false,
    is_refunded: false,
    spent_by: firstSweepTxId,
    tokens: 5000,
    transaction_id: commitTxId,
    transaction_vout: 2,
  };

  Object.keys(overrides).forEach(k => payment[k] = overrides[k]);

  return payment;
};

// The HTLC at commitment output 2 spent into the second level tx
const firstStage = makePayment({is_pending: true, spent_by: secondLevelTxId});

// The second level output at index 1 that is funded by commitment output 2
const secondStage = makePayment({
  is_paid: true,
  transaction_id: secondLevelTxId,
  transaction_vout: 1,
});

// The HTLC at commitment output 3 spent into the second level tx
const otherFirstStage = makePayment({
  is_pending: true,
  spent_by: secondLevelTxId,
  tokens: 7000,
  transaction_vout: 3,
});

// The second level output at index 0 that is funded by commitment output 3
const otherSecondStage = makePayment({
  is_paid: true,
  spent_by: secondSweepTxId,
  tokens: 7000,
  transaction_id: secondLevelTxId,
  transaction_vout: 0,
});

const makeArgs = overrides => {
  const args = {close_payments: [], transactions: []};

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({}),
    description: 'No payments are returned when there are none',
    expected: {payments: []},
  },
  {
    args: makeArgs({close_payments: [makePayment({is_paid: true})]}),
    description: 'A single stage payment is returned as is',
    expected: {payments: [makePayment({is_paid: true})]},
  },
  {
    args: makeArgs({close_payments: [firstStage]}),
    description: 'A first stage without a second stage remains pending',
    expected: {payments: [firstStage]},
  },
  {
    args: makeArgs({close_payments: [secondStage, firstStage]}),
    description: 'A second stage is linked to its first stage',
    expected: {
      payments: [makePayment({is_paid: true, spent_by: firstSweepTxId})],
    },
  },
  {
    args: makeArgs({
      close_payments: [
        firstStage,
        makePayment({
          is_outgoing: true,
          is_refunded: true,
          transaction_id: secondLevelTxId,
          transaction_vout: 1,
        }),
      ],
    }),
    description: 'A second stage in another direction is not linked',
    expected: {
      payments: [
        firstStage,
        makePayment({
          is_outgoing: true,
          is_refunded: true,
          transaction_id: secondLevelTxId,
          transaction_vout: 1,
        }),
      ],
    },
  },
  {
    args: makeArgs({
      close_payments: [
        firstStage,
        otherFirstStage,
        otherSecondStage,
        secondStage,
      ],
      transactions: [
        {id: walletTxId},
        {id: secondLevelTxId, transaction: secondLevelTx},
      ],
    }),
    description: 'Batched second stages are linked by input and output index',
    expected: {
      payments: [
        makePayment({is_paid: true, spent_by: firstSweepTxId}),
        makePayment({
          is_paid: true,
          spent_by: secondSweepTxId,
          tokens: 7000,
          transaction_vout: 3,
        }),
      ],
    },
  },
  {
    args: makeArgs({
      close_payments: [
        firstStage,
        otherFirstStage,
        otherSecondStage,
        secondStage,
      ],
    }),
    description: 'Batched second stages are not linked without the tx',
    expected: {
      payments: [
        firstStage,
        otherFirstStage,
        otherSecondStage,
        secondStage,
      ],
    },
  },
  {
    args: makeArgs({
      close_payments: [
        firstStage,
        makePayment({
          is_pending: true,
          spent_by: secondLevelTxId,
          transaction_vout: 4,
        }),
        secondStage,
      ],
      transactions: [{id: secondLevelTxId, transaction: secondLevelTx}],
    }),
    description: 'First stages missing in the second level tx are not linked',
    expected: {
      payments: [
        makePayment({is_paid: true, spent_by: firstSweepTxId}),
        makePayment({
          is_pending: true,
          spent_by: secondLevelTxId,
          transaction_vout: 4,
        }),
      ],
    },
  },
];

tests.forEach(({args, description, expected}) => {
  return test(description, () => {
    deepEqual(method(args), expected, 'Got expected payments');

    return;
  });
});
