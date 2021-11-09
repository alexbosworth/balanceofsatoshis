const {test} = require('@alexbosworth/tap');

const {getInfoResponse} = require('./../fixtures');
const {getLiquidity} = require('./../../balances');
const {listChannelsResponse} = require('./../fixtures');

const fs = {getFile: ({}, cbk) => cbk('err')};

const makeLnd = ({}) => {
  return {
    default: {
      getInfo: ({}, cbk) => cbk(null, getInfoResponse),
      listChannels: ({}, cbk) => cbk(null, listChannelsResponse),
      pendingChannels: ({}, cbk) => cbk(null, {
        pending_closing_channels: [],
        pending_force_closing_channels: [],
        pending_open_channels: [],
        total_limbo_balance: '1',
      }),
    },
  };
};

const tests = [
  {
    args: {fs},
    description: 'LND is required',
    error: [400, 'ExpectedLndToGetLiquidity'],
  },
  {
    args: {fs, is_outbound: true, lnd: makeLnd({}), max_fee_rate: 0},
    description: 'Max liquidity fee rate is not supported for outbound lookup',
    error: [400, 'MaxLiquidityFeeRateNotSupportedForOutbound'],
  },
  {
    args: {fs, lnd: makeLnd({}), min_node_score: 1, request: undefined},
    description: 'A request method is required for liquidity score lookups',
    error: [400, 'ExpectedRequestFunctionToFilterByNodeScore'],
  },
  {
    args: {fs, lnd: makeLnd({})},
    description: 'Get liquidity',
    expected: {balance: 1},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects}) => {
    if (!!error) {
      await rejects(getLiquidity(args), error, 'Got expected error');
    } else {
      const balances = await getLiquidity(args);

      equal(balances.balance, expected.balance, 'Balance is calculated');
    }

    return end();
  });
});
