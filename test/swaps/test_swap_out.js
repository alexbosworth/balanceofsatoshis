const {rejects} = require('node:assert').strict;
const test = require('node:test');

const swapOut = require('./../../swaps/swap_out');

const makeArgs = override => {
  const args = {
    avoid: [],
    confs: 1,
    fetch: () => {},
    fs: {getFile: () => {}},
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
    args: makeArgs({avoid: undefined}),
    description: 'An avoid array is required',
    error: [400, 'ExpectedAvoidArrayToInitiateSwapOut'],
  },
  {
    args: makeArgs({confs: undefined}),
    description: 'A confirmations count is required',
    error: [400, 'ExpectedConfirmationsCountToConsiderReorgSafe'],
  },
  {
    args: makeArgs({fetch: undefined}),
    description: 'A fetch function is required',
    error: [400, 'ExpectedFetchFunctionToInitiateSwapOut'],
  },
  {
    args: makeArgs({fs: undefined}),
    description: 'File system methods are required',
    error: [400, 'ExpectedFileSystemFunctionsToInitiateSwapOut'],
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is required',
    error: [400, 'ExpectedLndToInitiateSwapOut'],
  },
  {
    args: makeArgs({logger: undefined}),
    description: 'A logger is required',
    error: [400, 'ExpectedLoggerForSwapProgressNotifications'],
  },
  {
    args: makeArgs({max_deposit: 0}),
    description: 'A max deposit is expected to be above zero',
    error: [400, 'ExpectedMaxDepositAboveZeroToInitiateSwapOut'],
  },
  {
    args: makeArgs({max_fee: undefined}),
    description: 'A max fee is required',
    error: [400, 'ExpectedMaxFeeToIncreaseInboundLiquidity'],
  },
  {
    args: makeArgs({max_fee: 0}),
    description: 'A max fee is expected to be above zero',
    error: [400, 'ExpectedMaxFeeAboveZeroToInitiateSwapOut'],
  },
  {
    args: makeArgs({out_filters: 'filter'}),
    description: 'Out filters must be an array',
    error: [400, 'ExpectedArrayOfOutFiltersToInitiateSwapOut'],
  },
  {
    args: makeArgs({out_filters: ['OUTBOUND_LIQUIDITY > 0']}),
    description: 'Out filters require a peer or tag to filter',
    error: [400, 'ExpectedPeerOrTagToApplyOutFiltersTo'],
  },
  {
    args: makeArgs({out_address: 'address'}),
    description: 'A valid out address is required',
    error: [400, 'UnrecognizedFormatOfOutAddress'],
  },
  {
    args: makeArgs({socket: 'https://localhost:11010'}),
    description: 'A swap service socket is expected to be a host and port',
    error: [400, 'ExpectedHostAndPortSocketToInitiateSwapOut'],
  },
  {
    args: makeArgs({tokens: undefined}),
    description: 'Tokens are required when not recovering a swap',
    error: [400, 'ExpectedTokensToIncreaseLiquidity'],
  },
];

tests.forEach(({args, description, error}) => {
  return test(description, async () => {
    await rejects(swapOut(args), error, 'Got expected error');

    return;
  });
});
