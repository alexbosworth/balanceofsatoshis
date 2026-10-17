const {deepEqual} = require('node:assert').strict;
const test = require('node:test');

const method = require('./../../chain/is_contract_spend');

const contractTxId = Buffer.alloc(32, 1).toString('hex');
const otherTxId = Buffer.alloc(32, 2).toString('hex');

const tests = [
  {
    args: {id: otherTxId, outputs: [{id: contractTxId}], vout: 0},
    description: 'Spending another transaction is not a contract spend',
    expected: false,
  },
  {
    args: {id: contractTxId, outputs: [{id: contractTxId}], vout: 1},
    description: 'A contract output without an index refers to all outputs',
    expected: true,
  },
  {
    args: {id: contractTxId, outputs: [{id: contractTxId, vout: 1}], vout: 1},
    description: 'An input spending a specific contract output is a spend',
    expected: true,
  },
  {
    args: {id: contractTxId, outputs: [{id: contractTxId, vout: 1}], vout: 0},
    description: 'An input spending a different output is not a spend',
    expected: false,
  },
];

tests.forEach(({args, description, expected}) => {
  return test(description, () => {
    deepEqual(method(args), expected, 'Got expected contract spend status');

    return;
  });
});
