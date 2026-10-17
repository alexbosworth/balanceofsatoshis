const {deepEqual} = require('node:assert').strict;
const test = require('node:test');
const {throws} = require('node:assert').strict;

const method = require('./../../chain/utxo_split_plan');

const feeRate = 10;
const size = 1e5;
const txId = Buffer.alloc(32).toString('hex');

const makeUtxo = ({confirmations, format, tokens, vout}) => ({
  address_format: format || 'p2wpkh',
  confirmation_count: confirmations,
  tokens,
  transaction_id: txId,
  transaction_vout: vout,
});

const spend = vouts => vouts.map(vout => ({
  transaction_id: txId,
  transaction_vout: vout,
}));

// Two UTXOs are large enough, but only one large one is confirmed
const utxos = [
  makeUtxo({confirmations: 1, tokens: 200000, vout: 0}),
  makeUtxo({confirmations: 0, tokens: 150000, vout: 1}),
  makeUtxo({confirmations: 1, tokens: 50000, vout: 2}),
];

const makeArgs = overrides => {
  const args = {size, utxos, count: 3, fee_tokens_per_vbyte: feeRate};

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({count: undefined}),
    description: 'A count of utxos is required',
    error: 'ExpectedCountOfUtxosToPlanUtxoSplit',
  },
  {
    args: makeArgs({fee_tokens_per_vbyte: undefined}),
    description: 'A fee rate is required',
    error: 'ExpectedFeeRateToPlanUtxoSplit',
  },
  {
    args: makeArgs({size: undefined}),
    description: 'A utxo size is required',
    error: 'ExpectedSizeOfUtxosToPlanUtxoSplit',
  },
  {
    args: makeArgs({utxos: undefined}),
    description: 'Utxos are required',
    error: 'ExpectedArrayOfUtxosToPlanUtxoSplit',
  },
  {
    args: makeArgs({count: 1}),
    description: 'Nothing is spent when there are more than enough utxos',
    expected: {inputs: [], outputs: 0},
  },
  {
    args: makeArgs({count: 2}),
    description: 'Nothing is spent when there are exactly enough utxos',
    expected: {inputs: [], outputs: 0},
  },
  {
    args: makeArgs({}),
    description: 'A spent counted utxo is replaced and large change counts',
    expected: {inputs: spend([0, 2]), outputs: 1},
  },
  {
    args: makeArgs({
      count: 2,
      utxos: [makeUtxo({confirmations: 1, tokens: 200000, vout: 0})],
    }),
    description: 'A split that only replaces the spent utxo is rejected',
    error: 'InsufficientBalanceToSplitUtxos',
  },
  {
    args: makeArgs({count: 4}),
    description: 'A split is rejected when funds cannot support the count',
    error: 'InsufficientBalanceToSplitUtxos',
  },
  {
    args: makeArgs({
      count: 2,
      utxos: [makeUtxo({confirmations: 0, tokens: 150000, vout: 1})],
    }),
    description: 'Unconfirmed utxos are not spent',
    error: 'InsufficientBalanceToSplitUtxos',
  },
  {
    args: makeArgs({count: 2, is_confirmed: true}),
    description: 'Unconfirmed utxos are not counted when confirmed only',
    expected: {inputs: spend([0, 2]), outputs: 1},
  },
  {
    args: makeArgs({is_confirmed: true}),
    description: 'Confirmed funds must support the count when confirmed only',
    error: 'InsufficientBalanceToSplitUtxos',
  },
  {
    args: makeArgs({
      count: 4,
      utxos: [
        makeUtxo({confirmations: 1, tokens: 60000, vout: 1}),
        makeUtxo({confirmations: 1, tokens: 1e6, vout: 0}),
      ],
    }),
    description: 'Change from a large utxo counts as one of the new utxos',
    expected: {inputs: spend([0]), outputs: 3},
  },
  {
    args: makeArgs({
      count: 1,
      utxos: [
        makeUtxo({confirmations: 1, tokens: 60000, vout: 0}),
        makeUtxo({confirmations: 1, tokens: 60000, vout: 1}),
      ],
    }),
    description: 'Small utxos are combined when change does not qualify',
    expected: {inputs: spend([1, 0]), outputs: 1},
  },
  {
    args: makeArgs({
      count: 2,
      utxos: [
        makeUtxo({confirmations: 1, tokens: 100000, vout: 0}),
        makeUtxo({confirmations: 1, tokens: 30000, vout: 1}),
        makeUtxo({confirmations: 1, tokens: 500, vout: 2}),
        makeUtxo({confirmations: 1, tokens: 90000, vout: 3}),
      ],
    }),
    description: 'Utxos that cannot add value to the split are not spent',
    expected: {inputs: spend([3, 1]), outputs: 1},
  },
  {
    args: makeArgs({
      count: 2,
      utxos: [
        makeUtxo({confirmations: 1, format: 'p2tr', tokens: 201430, vout: 0}),
      ],
    }),
    description: 'Change exactly at the size counts as a new utxo',
    expected: {inputs: spend([0]), outputs: 1},
  },
  {
    args: makeArgs({
      count: 2,
      utxos: [
        makeUtxo({confirmations: 1, format: 'p2tr', tokens: 201429, vout: 0}),
      ],
    }),
    description: 'An output replaces the spent utxo when change is too small',
    expected: {inputs: spend([0]), outputs: 2},
  },
  {
    args: makeArgs({
      count: 2,
      utxos: [
        makeUtxo({confirmations: 1, format: 'p2tr', tokens: 201309, vout: 0}),
      ],
    }),
    description: 'A split is rejected when it cannot replace the spent utxo',
    error: 'InsufficientBalanceToSplitUtxos',
  },
  {
    args: makeArgs({
      count: 2,
      utxos: [makeUtxo({confirmations: 1, format: 'np2wpkh', tokens: 201500})],
    }),
    description: 'Nested inputs are larger than taproot inputs',
    error: 'InsufficientBalanceToSplitUtxos',
  },
  {
    args: makeArgs({
      count: 2,
      utxos: [makeUtxo({confirmations: 1, format: 'unknown', tokens: 201500})],
    }),
    description: 'Unknown input formats use the largest input size',
    error: 'InsufficientBalanceToSplitUtxos',
  },
  {
    args: makeArgs({
      count: 300,
      utxos: [makeUtxo({confirmations: 1, tokens: 1e9, vout: 0})],
    }),
    description: 'A large count of outputs can be funded',
    expected: {inputs: spend([0]), outputs: 299},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, (t, end) => {
    if (!!error) {
      throws(() => method(args), new Error(error), 'Got expected error');
    } else {
      deepEqual(method(args), expected, 'Got expected result');
    }

    return end();
  });
});
