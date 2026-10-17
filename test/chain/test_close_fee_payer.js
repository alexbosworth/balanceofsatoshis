const {deepEqual} = require('node:assert').strict;
const test = require('node:test');

const {transactionFromComponents} = require('@alexbosworth/blockchain');

const method = require('./../../chain/close_fee_payer');

const simpleCloseSequence = 0xfffffffd;

const makeTx = ({sequence}) => {
  return transactionFromComponents({
    inputs: [{
      sequence,
      id: Buffer.alloc(32).toString('hex'),
      script: '',
      vout: 0,
    }],
    locktime: 0,
    outputs: [{script: `0014${'03'.repeat(20)}`, tokens: 1}],
    version: 2,
  }).transaction;
};

const legacyCloseTx = makeTx({sequence: 0xffffffff});
const simpleCloseTx = makeTx({sequence: simpleCloseSequence});

const tests = [
  {
    args: {is_partner_initiated: true},
    description: 'A force close is paid for by the peer opener',
    expected: {is_peer_paying: true},
  },
  {
    args: {is_partner_initiated: false},
    description: 'A force close is paid for by the local opener',
    expected: {is_peer_paying: false},
  },
  {
    args: {},
    description: 'A force close with an unknown opener has an unknown payer',
    expected: {is_peer_paying: undefined},
  },
  {
    args: {
      is_cooperative_close: true,
      is_partner_closed: true,
      is_partner_initiated: true,
    },
    description: 'A cooperative close by the peer opener is paid by the peer',
    expected: {is_peer_paying: true},
  },
  {
    args: {
      is_cooperative_close: true,
      is_partner_closed: false,
      is_partner_initiated: false,
    },
    description: 'A cooperative close by the local opener is paid locally',
    expected: {is_peer_paying: false},
  },
  {
    args: {
      is_cooperative_close: true,
      is_partner_closed: true,
      is_partner_initiated: false,
    },
    description: 'The payer is unknown when the close protocol is unknown',
    expected: {},
  },
  {
    args: {
      is_cooperative_close: true,
      is_partner_closed: true,
      is_partner_initiated: false,
      transaction: legacyCloseTx,
    },
    description: 'A legacy close is paid by the opener',
    expected: {is_peer_paying: false},
  },
  {
    args: {
      is_cooperative_close: true,
      is_partner_closed: true,
      is_partner_initiated: false,
      transaction: simpleCloseTx,
    },
    description: 'A simple close is paid by the closer',
    expected: {is_peer_paying: true},
  },
  {
    args: {
      is_cooperative_close: true,
      is_partner_closed: true,
      transaction: legacyCloseTx,
    },
    description: 'A legacy close with an unknown opener has an unknown payer',
    expected: {is_peer_paying: undefined},
  },
  {
    args: {
      is_cooperative_close: true,
      is_partner_initiated: false,
      transaction: simpleCloseTx,
    },
    description: 'A simple close with an unknown closer has an unknown payer',
    expected: {is_peer_paying: undefined},
  },
];

tests.forEach(({args, description, expected}) => {
  return test(description, () => {
    deepEqual(method(args), expected, 'Got expected close fee payer');

    return;
  });
});
