const {test} = require('@alexbosworth/tap');

const {chanInfoResponse} = require('./../fixtures');
const channels = require('./../fixtures').liquidityChannelsResponse;
const {getInfoResponse} = require('./../fixtures');
const {getLiquidity} = require('./../../balances');
const {getNodeInfoResponse} = require('./../fixtures');

const makeLnd = () => {
  return {
    default: {
      getChanInfo: ({}, cbk) => cbk(null, chanInfoResponse),
      getInfo: ({}, cbk) => cbk(null, getInfoResponse),
      getNodeInfo: ({}, cbk) => cbk(null, getNodeInfoResponse),
      listChannels: ({}, cbk) => cbk(null, {channels}),
    },
  };
};

const tests = [
  {
    args: {},
    description: 'LND is required',
    error: [400, 'ExpectedLndToGetLiquidity'],
  },
  {
    args: {is_outbound: true, lnd: makeLnd({}), max_fee_rate: 1},
    description: 'Fee rate is not supported for outbound liquidity',
    error: [400, 'MaxLiquidityFeeRateNotSupportedForOutbound'],
  },
  {
    args: {lnd: makeLnd({}), min_node_score: 1},
    description: 'A request method is required when node score specified',
    error: [400, 'ExpectedRequestFunctionToFilterByNodeScore'],
  },
  {
    args: {
      lnd: makeLnd({}),
      min_node_score: 1,
      request: ({}, cbk) => cbk('err'),
    },
    description: 'Errors from request method are passed back',
    error: [503, 'UnexpectedErrorGettingNodeScores'],
  },
  {
    args: {is_top: true, lnd: makeLnd({})},
    description: 'Liquidity is returned',
    expected: {balance: 1},
  },
  {
    args: {is_outbound: true, lnd: makeLnd({}), with: 'b'},
    description: 'Liquidity is returned for outbound request',
    expected: {balance: 3},
  },
  {
    args: {lnd: makeLnd({}), max_fee_rate: 1},
    description: 'Liquidity is returned with max fee rate',
    expected: {balance: 0},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects}) => {
    if (!!error) {
      rejects(getLiquidity(args), error, 'Got expected error');
    } else {
      const {balance} = await getLiquidity(args);

      equal(balance, expected.balance, 'Balance is calculated');
    }

    return end();
  });
});
