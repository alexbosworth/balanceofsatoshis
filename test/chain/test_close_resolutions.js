const {deepEqual} = require('node:assert').strict;
const test = require('node:test');

const {transactionFromComponents} = require('@alexbosworth/blockchain');

const method = require('./../../chain/close_resolutions');

const closeTxId = Buffer.alloc(32, 1).toString('hex');
const sweepTxId = Buffer.alloc(32, 2).toString('hex');
const htlcSweepTxId = Buffer.alloc(32, 3).toString('hex');
const secondLevelTxId = Buffer.alloc(32, 4).toString('hex');

// The commitment pays out an HTLC, a balance and an anchor output
const closeTx = transactionFromComponents({
  inputs: [{id: Buffer.alloc(32).toString('hex'), script: '', vout: 0}],
  locktime: 0,
  outputs: [
    {script: `0020${'03'.repeat(32)}`, tokens: 5000},
    {script: `0020${'04'.repeat(32)}`, tokens: 90000},
    {script: `0020${'05'.repeat(32)}`, tokens: 330},
  ],
  version: 2,
}).transaction;

const makePayment = overrides => {
  const payment = {
    is_outgoing: true,
    is_paid: false,
    is_pending: false,
    is_refunded: false,
    spent_by: htlcSweepTxId,
    tokens: 5000,
    transaction_id: closeTxId,
    transaction_vout: 0,
  };

  Object.keys(overrides).forEach(k => payment[k] = overrides[k]);

  return payment;
};

const makeArgs = overrides => {
  const args = {
    close_payments: [],
    close_transaction_id: closeTxId,
    transactions: [{id: closeTxId, transaction: closeTx}],
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({}),
    description: 'No resolutions are returned when there are none',
    expected: {resolutions: []},
  },
  {
    args: makeArgs({close_balance_spent_by: sweepTxId, close_balance_vout: 1}),
    description: 'A swept balance is returned with its value',
    expected: {
      resolutions: [{
        transaction_id: sweepTxId,
        type: 'balance_swept',
        value: 90000,
      }],
    },
  },
  {
    args: makeArgs({
      close_balance_spent_by: sweepTxId,
      close_balance_vout: 1,
      transactions: [{id: closeTxId}],
    }),
    description: 'Values are unknown when the close tx is not in the wallet',
    expected: {
      resolutions: [{
        transaction_id: sweepTxId,
        type: 'balance_swept',
        value: undefined,
      }],
    },
  },
  {
    args: makeArgs({
      close_balance_spent_by: sweepTxId,
      close_balance_vout: 5,
    }),
    description: 'Values are unknown when the close tx has no such output',
    expected: {
      resolutions: [{
        transaction_id: sweepTxId,
        type: 'balance_swept',
        value: undefined,
      }],
    },
  },
  {
    args: makeArgs({
      anchor_is_confirmed: true,
      anchor_spent_by: sweepTxId,
      anchor_vout: 2,
    }),
    description: 'A swept anchor is returned',
    expected: {
      resolutions: [{
        transaction_id: sweepTxId,
        type: 'anchor_swept',
        value: 330,
      }],
    },
  },
  {
    args: makeArgs({anchor_is_pending: true, anchor_vout: 2}),
    description: 'A pending anchor is returned',
    expected: {
      resolutions: [{
        transaction_id: undefined,
        type: 'anchor_pending',
        value: 330,
      }],
    },
  },
  {
    args: makeArgs({anchor_vout: 2}),
    description: 'An unclaimed anchor is returned',
    expected: {
      resolutions: [{
        transaction_id: undefined,
        type: 'anchor_unclaimed',
        value: 330,
      }],
    },
  },
  {
    args: makeArgs({
      close_payments: [
        makePayment({is_paid: true}),
        makePayment({is_refunded: true}),
        makePayment({is_pending: true, spent_by: undefined}),
        makePayment({spent_by: undefined}),
        makePayment({is_outgoing: false, is_paid: true}),
        makePayment({is_outgoing: false, is_refunded: true}),
      ],
    }),
    description: 'HTLC payments are returned with their outcomes',
    expected: {
      resolutions: [
        {
          transaction_id: htlcSweepTxId,
          type: 'outgoing_htlc_paid',
          value: 5000,
        },
        {
          transaction_id: htlcSweepTxId,
          type: 'outgoing_htlc_refunded',
          value: 5000,
        },
        {
          transaction_id: undefined,
          type: 'outgoing_htlc_pending',
          value: 5000,
        },
        {
          transaction_id: undefined,
          type: 'outgoing_htlc_unclaimed',
          value: 5000,
        },
        {
          transaction_id: htlcSweepTxId,
          type: 'incoming_htlc_paid',
          value: 5000,
        },
        {
          transaction_id: htlcSweepTxId,
          type: 'incoming_htlc_refunded',
          value: 5000,
        },
      ],
    },
  },
  {
    args: makeArgs({
      close_payments: [
        makePayment({
          is_outgoing: false,
          is_pending: true,
          spent_by: secondLevelTxId,
        }),
        makePayment({
          is_outgoing: false,
          is_paid: true,
          tokens: 4800,
          transaction_id: secondLevelTxId,
        }),
      ],
    }),
    description: 'HTLCs resolved over two stages have their final outcome',
    expected: {
      resolutions: [{
        transaction_id: htlcSweepTxId,
        type: 'incoming_htlc_paid',
        value: 5000,
      }],
    },
  },
  {
    args: makeArgs({
      anchor_is_confirmed: true,
      anchor_spent_by: sweepTxId,
      anchor_vout: 2,
      close_balance_spent_by: sweepTxId,
      close_balance_vout: 1,
      close_payments: [makePayment({is_paid: true})],
    }),
    description: 'Resolutions are ordered by close transaction output index',
    expected: {
      resolutions: [
        {
          transaction_id: htlcSweepTxId,
          type: 'outgoing_htlc_paid',
          value: 5000,
        },
        {transaction_id: sweepTxId, type: 'balance_swept', value: 90000},
        {transaction_id: sweepTxId, type: 'anchor_swept', value: 330},
      ],
    },
  },
];

tests.forEach(({args, description, expected}) => {
  return test(description, () => {
    deepEqual(method(args), expected, 'Got expected resolutions');

    return;
  });
});
