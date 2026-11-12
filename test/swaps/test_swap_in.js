const {rejects} = require('node:assert').strict;
const test = require('node:test');

const swapIn = require('./../../swaps/swap_in');

const makeArgs = override => {
  const args = {
    fetch: () => {},
    lnd: {},
    logger: {},
    max_fee: 1,
    tokens: 1,
  };

  Object.keys(override).forEach(key => args[key] = override[key]);

  return args;
};

const tests = [
  {
    args: makeArgs({fetch: undefined}),
    description: 'A fetch function is required',
    error: [400, 'ExpectedFetchFunctionToReceiveOnChain'],
  },
  {
    args: makeArgs({logger: undefined}),
    description: 'A logger is required',
    error: [400, 'ExpectedLoggerToReceiveOnChain'],
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is required',
    error: [400, 'ExpectedLndToReceiveOnChain'],
  },
  {
    args: makeArgs({max_fee: undefined}),
    description: 'A max fee is required',
    error: [400, 'ExpectedMaxFeeToReceiveOnChain'],
  },
  {
    args: makeArgs({max_fee: 0}),
    description: 'A max fee is expected to be above zero',
    error: [400, 'ExpectedMaxFeeAboveZeroToReceiveOnChain'],
  },
  {
    args: makeArgs({max_fee_rate: 0}),
    description: 'A max fee rate is expected to be above zero',
    error: [400, 'ExpectedMaxFeeRateAboveZeroToReceiveOnChain'],
  },
  {
    args: makeArgs({max_fee_rate: 1.5}),
    description: 'A max fee rate is expected to be a whole number',
    error: [400, 'ExpectedMaxFeeRateAboveZeroToReceiveOnChain'],
  },
  {
    args: makeArgs({refund_address: 'address'}),
    description: 'A recovery is required to refund',
    error: [400, 'ExpectedRecoveryOfAddressToRefundDeposits'],
  },
  {
    args: makeArgs({socket: 'https://localhost:11010'}),
    description: 'A swap service socket is expected to be a host and port',
    error: [400, 'ExpectedHostAndPortSocketToReceiveOnChain'],
  },
  {
    args: makeArgs({tokens: undefined}),
    description: 'Tokens are required',
    error: [400, 'ExpectedTokensAmountToReceiveOnChain'],
  },
];

tests.forEach(({args, description, error}) => {
  return test(description, async () => {
    await rejects(swapIn(args), error, 'Got expected error');

    return;
  });
});
