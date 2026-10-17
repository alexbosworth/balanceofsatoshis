const {deepEqual} = require('node:assert').strict;
const test = require('node:test');

const method = require('./../../chain/contract_outputs');

const closeTxId = Buffer.alloc(32, 1).toString('hex');
const htlcTxId = Buffer.alloc(32, 2).toString('hex');

const tests = [
  {
    args: {payments: []},
    description: 'There are no contract outputs without close details',
    expected: [],
  },
  {
    args: {close_transaction_id: closeTxId, payments: []},
    description: 'All outputs of the close transaction are contract outputs',
    expected: [{id: closeTxId}],
  },
  {
    args: {
      close_transaction_id: closeTxId,
      payments: [{transaction_id: htlcTxId, transaction_vout: 1}],
    },
    description: 'HTLC outputs are referred to specifically',
    expected: [{id: closeTxId}, {id: htlcTxId, vout: 1}],
  },
];

tests.forEach(({args, description, expected}) => {
  return test(description, () => {
    deepEqual(method(args), expected, 'Got expected contract outputs');

    return;
  });
});
