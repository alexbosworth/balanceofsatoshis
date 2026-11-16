const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {getFiatRates} = require('./../../balances');
const {getInfoResponse} = require('./../fixtures');

// A day with a chain price, the same day later on, a day with an exchange
// price before the chain prices start, and a day before any known price
const chainDate = '2024-01-01T12:00:00.000Z';
const earlyDate = '1970-01-01T00:00:01.000Z';
const exchangeDate = '2017-06-01T12:00:00.000Z';
const laterDate = '2024-01-01T23:59:59.000Z';

// A node on testnet
const testnetInfo = Object.assign({}, getInfoResponse, {
  chains: [{chain: 'bitcoin', network: 'testnet'}],
});

// File system methods for chain prices that should not be needed
const makeFs = () => ({
  getFile: (path, cbk) => cbk('err'),
  makeDirectory: (path, cbk) => cbk('err'),
  renameFile: (from, to, cbk) => cbk('err'),
  writeFile: (path, contents, cbk) => cbk('err'),
});

const makeLnd = ({info}) => ({
  default: {getInfo: ({}, cbk) => cbk(null, info || getInfoResponse)},
});

const makeArgs = overrides => {
  const args = {dates: [chainDate], fs: makeFs(), lnds: [makeLnd({})]};

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const makeExpected = overrides => {
  const expected = {
    fiat: 'USD',
    rates: [{cents: 4266048, date: chainDate}],
  };

  Object.keys(overrides).forEach(k => expected[k] = overrides[k]);

  return expected;
};

const tests = [
  {
    args: makeArgs({dates: undefined}),
    description: 'Dates are required',
    error: [400, 'ExpectedArrayOfDatesToGetFiatRates'],
  },
  {
    args: makeArgs({fs: undefined}),
    description: 'File system methods are required',
    error: [400, 'ExpectedFileSystemMethodsToGetFiatRates'],
  },
  {
    args: makeArgs({fs: {getFile: (path, cbk) => cbk('err')}}),
    description: 'Complete file system methods are required',
    error: [400, 'ExpectedFileSystemMethodsToGetFiatRates'],
  },
  {
    args: makeArgs({lnds: undefined}),
    description: 'LNDs are required',
    error: [400, 'ExpectedAuthenticatedLndsToGetFiatRates'],
  },
  {
    args: makeArgs({lnds: []}),
    description: 'An LND is required',
    error: [400, 'ExpectedAuthenticatedLndsToGetFiatRates'],
  },
  {
    args: makeArgs({lnds: [makeLnd({}), makeLnd({info: testnetInfo})]}),
    description: 'Nodes have to be on the same network',
    error: [400, 'ExpectedSameNetworkNodesToGetFiatRates'],
  },
  {
    args: makeArgs({lnds: [makeLnd({info: testnetInfo})]}),
    description: 'Nodes have to be on mainnet, which has chain prices',
    error: [400, 'ExpectedMainnetNodesToGetFiatRates'],
  },
  {
    args: makeArgs({dates: [earlyDate]}),
    description: 'A date without a known price is not looked up elsewhere',
    error: [
      400,
      'DateBeforeSupportedRangeToGetChainRate',
      {earliest_day: '2013-03-31'},
    ],
  },
  {
    args: makeArgs({dates: []}),
    description: 'No dates have no rates',
    expected: makeExpected({rates: []}),
  },
  {
    args: makeArgs({}),
    description: 'A date on a day with a chain price is valued with it',
    expected: makeExpected({}),
  },
  {
    args: makeArgs({dates: [laterDate, chainDate]}),
    description: 'Dates on the same day are valued with the price of the day',
    expected: makeExpected({
      rates: [
        {cents: 4266048, date: laterDate},
        {cents: 4266048, date: chainDate},
      ],
    }),
  },
  {
    args: makeArgs({dates: [exchangeDate]}),
    description: 'A date before chain prices is valued with exchange prices',
    expected: makeExpected({rates: [{cents: 239384, date: exchangeDate}]}),
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(getFiatRates(args), error, 'Got expected error');
    } else {
      deepEqual(await getFiatRates(args), expected, 'Got expected rates');
    }

    return;
  });
});
