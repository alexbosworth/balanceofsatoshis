const {deepEqual} = require('node:assert').strict;
const test = require('node:test');
const {throws} = require('node:assert').strict;

const blindedPathFee = require('./../../network/blinded_path_fee');

const hop = {encrypted_data: '00', relay_key: Buffer.alloc(33, 2)};

const makeArgs = overrides => {
  const args = {
    mtokens: '1000000',
    path: {base_fee_mtokens: '2001', fee_rate: 201, hops: [hop, hop, hop]},
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({mtokens: 1000000}),
    description: 'Millitokens are expected as a string',
    error: 'ExpectedMillitokensToCalculateBlindedPathFee',
  },
  {
    args: makeArgs({path: undefined}),
    description: 'A path is expected',
    error: 'ExpectedBlindedPathToCalculateBlindedPathFee',
  },
  {
    args: makeArgs({path: {fee_rate: 1, hops: [hop, hop]}}),
    description: 'A path base fee is expected',
    error: 'ExpectedBaseFeeMillitokensToCalculateBlindedPathFee',
  },
  {
    args: makeArgs({path: {base_fee_mtokens: '1', hops: [hop, hop]}}),
    description: 'A path fee rate is expected',
    error: 'ExpectedFeeRateToCalculateBlindedPathFee',
  },
  {
    args: makeArgs({path: {base_fee_mtokens: '1', fee_rate: 1, hops: []}}),
    description: 'Path hops are expected',
    error: 'ExpectedPathHopsToCalculateBlindedPathFee',
  },
  {
    args: makeArgs({}),
    description: 'The fee is the base fee plus the proportional fee',
    expected: {fee_mtokens: '2202'},
  },
  {
    args: makeArgs({mtokens: '1'}),
    description: 'The proportional fee rounds down',
    expected: {fee_mtokens: '2001'},
  },
  {
    args: makeArgs({
      path: {base_fee_mtokens: '2001', fee_rate: 201, hops: [hop]},
    }),
    description: 'A path that is only the destination has no fee',
    expected: {fee_mtokens: '0'},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, () => {
    if (!!error) {
      throws(() => blindedPathFee(args), new Error(error), 'Got error');
    } else {
      deepEqual(blindedPathFee(args), expected, 'Got expected fee');
    }

    return;
  });
});
