const {deepEqual} = require('node:assert').strict;
const EventEmitter = require('node:events');
const {rejects} = require('node:assert').strict;
const test = require('node:test');

// Charts segment by local days, so the fixture days are checked in UTC
process.env.TZ = 'UTC';

const {getChainFeesChart} = require('./../../routing');
const {getInfoResponse} = require('./../fixtures');

const currentHeight = 900000;

// File system methods for chain prices, which known prices do not need
const fs = {
  getFile: (path, cbk) => cbk('err'),
  makeDirectory: (path, cbk) => cbk('err'),
  renameFile: (from, to, cbk) => cbk('err'),
  writeFile: (path, contents, cbk) => cbk('err'),
};

// A transaction that paid a 1 BTC fee on a day with a known price
const feeTx = {
  amount: '-100000000',
  block_hash: Buffer.alloc(32).toString('hex'),
  block_height: 1,
  dest_addresses: [],
  num_confirmations: 1,
  previous_outpoints: [],
  raw_tx_hex: '',
  time_stamp: '1704283200',
  total_fees: '100000000',
  tx_hash: Buffer.alloc(32).toString('hex'),
};

// A blocks subscription that reports the current chain tip
const makeBlocks = ({}) => {
  const stream = new EventEmitter();

  stream.cancel = () => {};

  setImmediate(() => {
    return stream.emit('data', {
      hash: Buffer.alloc(32),
      height: currentHeight,
    });
  });

  return stream;
};

// The chart data as a string, and whether there is a description
const summary = ({data, description, title}) => ({
  title,
  data: data.join(','),
  is_described: !!description,
});

const makeLnds = ({txs}) => [{
  chain: {registerBlockEpochNtfn: makeBlocks},
  default: {
    closedChannels: ({}, cbk) => cbk(null, {channels: []}),
    getInfo: ({}, cbk) => cbk(null, getInfoResponse),
    getTransactions: ({}, cbk) => cbk(null, {transactions: txs}),
  },
  wallet: {
    listSweeps: ({}, cbk) => {
      return cbk(null, {transaction_ids: {transaction_ids: []}});
    },
  },
}];

const makeArgs = overrides => {
  const args = {
    fs,
    end_date: '2024-01-07',
    is_monochrome: true,
    lnds: makeLnds({txs: [feeTx]}),
    start_date: '2024-01-01',
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const makeExpected = overrides => {
  const expected = {
    data: '0,0,100000000,0,0,0,0',
    is_described: true,
    title: 'Chain fees paid',
  };

  Object.keys(overrides).forEach(k => expected[k] = overrides[k]);

  return expected;
};

const tests = [
  {
    args: makeArgs({lnds: undefined}),
    description: 'LND is required to get chain fees chart',
    error: [400, 'ExpectedLndToGetChainFeesChart'],
  },
  {
    args: makeArgs({}),
    description: 'Chain fees chart data is returned in tokens',
    expected: makeExpected({}),
  },
  {
    args: makeArgs({is_fiat: true}),
    description: 'Chain fees chart data is returned in fiat',
    expected: makeExpected({
      data: '0,0,42775.74,0,0,0,0',
      title: 'Chain fees paid (USD)',
    }),
  },
  {
    args: makeArgs({is_fiat: true, lnds: makeLnds({txs: []})}),
    description: 'Chain fees chart data without fees is returned in fiat',
    expected: makeExpected({
      data: '0,0,0,0,0,0,0',
      title: 'Chain fees paid (USD)',
    }),
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(getChainFeesChart(args), error, 'Got expected error');
    } else {
      deepEqual(summary(await getChainFeesChart(args)), expected, 'Got chart');
    }

    return;
  });
});
