const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

// Charts segment by local days, so the fixture days are checked in UTC
process.env.TZ = 'UTC';

const {chanInfoResponse} = require('./../fixtures');
const {getFeesChart} = require('./../../routing');
const {getInfoResponse} = require('./../fixtures');
const {getNodeInfoResponse} = require('./../fixtures');
const {versionInfoResponse} = require('./../fixtures');

const fs = {getFile: ({}, cbk) => cbk('err')};

// File system methods for chain prices, which known prices do not need
const fiatFs = {
  getFile: (path, cbk) => cbk('err'),
  makeDirectory: (path, cbk) => cbk('err'),
  renameFile: (from, to, cbk) => cbk('err'),
  writeFile: (path, contents, cbk) => cbk('err'),
};

// A node that forwarded 2 BTC for a 1 BTC fee on a day with a known price
const fiatLnds = [{
  default: {
    closedChannels: ({}, cbk) => cbk(null, {channels: []}),
    forwardingHistory: ({index_offset}, cbk) => cbk(null, {
      // The forward is on the first page, the next page is empty
      forwarding_events: !!index_offset ? [] : [{
        amt_in: '300000000',
        amt_in_msat: '300000000000',
        amt_out: '200000000',
        amt_out_msat: '200000000000',
        chan_id_in: '1',
        chan_id_out: '2',
        fee: '100000000',
        fee_msat: '100000000000',
        timestamp: '1704283200',
        timestamp_ns: '1704283200000000000',
      }],
      last_offset_index: '1',
    }),
    getInfo: ({}, cbk) => cbk(null, getInfoResponse),
    listChannels: ({}, cbk) => cbk(null, {channels: []}),
  },
  version: {
    getVersion: ({}, cbk) => cbk(null, versionInfoResponse),
  },
}];

const lnds = [{
  default: {
    closedChannels: ({}, cbk) => cbk(null, {channels: []}),
    forwardingHistory: ({}, cbk) => cbk(null, {
      forwarding_events: [],
      last_offset_index: '0',
    }),
    getChanInfo: ({}, cbk) => cbk(null, chanInfoResponse),
    getNodeInfo: ({}, cbk) => cbk(null, getNodeInfoResponse),
    listChannels: ({}, cbk) => cbk(null, {channels: []}),
  },
  version: {
    getVersion: ({}, cbk) => cbk(null, versionInfoResponse),
  },
}];

// The node of a peer without an alias, so its public key is shown instead
const noAliasLnds = [{
  default: {
    closedChannels: ({}, cbk) => cbk(null, {channels: []}),
    forwardingHistory: ({}, cbk) => cbk(null, {
      forwarding_events: [],
      last_offset_index: '0',
    }),
    getNodeInfo: ({}, cbk) => {
      return cbk(null, {
        channels: [],
        node: {
          addresses: [],
          alias: '',
          color: '#000000',
          features: {},
          last_update: '1',
          pub_key: Buffer.alloc(33).toString('hex'),
        },
        num_channels: 1,
        total_capacity: '1',
      });
    },
    listChannels: ({}, cbk) => cbk(null, {channels: []}),
  },
  version: {
    getVersion: ({}, cbk) => cbk(null, versionInfoResponse),
  },
}];

// The week of the forward, which is charted over dates
const forwardWeek = {
  days: undefined,
  end_date: '2024-01-07',
  fs: fiatFs,
  lnds: fiatLnds,
  start_date: '2024-01-01',
};

const peer = Buffer.alloc(33).toString('hex');

// The chart data as a string, and whether there is a description
const summary = ({data, description, title}) => ({
  title,
  data: data.join(','),
  is_described: !!description,
});

const makeArgs = overrides => {
  const args = {fs, lnds, days: 7};

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const makeExpected = overrides => {
  const expected = {
    data: '0,0,0,0,0,0,0',
    is_described: true,
    title: 'Routing fees earned',
  };

  Object.keys(overrides).forEach(k => expected[k] = overrides[k]);

  return expected;
};

const tests = [
  {
    args: makeArgs({days: 1, lnds: undefined}),
    description: 'LND is required to get fees chart',
    error: [400, 'ExpectedLndToGetFeesChart'],
  },
  {
    args: makeArgs({days: 1}),
    description: 'Fee earnings chart data is returned',
    expected: makeExpected({
      data: '0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0',
    }),
  },
  {
    args: makeArgs({days: 100, lnds: noAliasLnds, via: peer}),
    description: 'No alias uses pubkey instead',
    expected: makeExpected({
      data: '0,0,0,0,0,0,0,0,0,0,0,0,0,0',
      title: 'Routing fees earned via 000000000000000000000000000000000000000000000000000000000000000000',
    }),
  },
  {
    args: makeArgs({}),
    description: 'Fee earnings chart data over a week is returned',
    expected: makeExpected({}),
  },
  {
    args: makeArgs({days: 100, via: peer}),
    description: 'Fee earnings chart data via a peer is returned',
    expected: makeExpected({
      data: '0,0,0,0,0,0,0,0,0,0,0,0,0,0',
      title: 'Routing fees earned via alias',
    }),
  },
  {
    args: makeArgs({is_count: true, is_fiat: true}),
    description: 'Forwards count cannot be valued in fiat',
    error: [400, 'ExpectedEitherCountOrFiatForFeesChart'],
  },
  {
    args: makeArgs(forwardWeek),
    description: 'Fee earnings chart data is returned in tokens',
    expected: makeExpected({data: '0,0,100000000,0,0,0,0'}),
  },
  {
    args: makeArgs({...forwardWeek, is_fiat: true}),
    description: 'Fee earnings chart data is returned in fiat',
    expected: makeExpected({
      data: '0,0,42775.74,0,0,0,0',
      title: 'Routing fees earned (USD)',
    }),
  },
  {
    args: makeArgs({...forwardWeek, is_forwarded: true}),
    description: 'Forwarded amount chart data is returned in tokens',
    expected: makeExpected({
      data: '0,0,200000000,0,0,0,0',
      title: 'Forwarded amount',
    }),
  },
  {
    args: makeArgs({...forwardWeek, is_fiat: true, is_forwarded: true}),
    description: 'Forwarded amount chart data is returned in fiat',
    expected: makeExpected({
      data: '0,0,85551.48,0,0,0,0',
      title: 'Forwarded amount (USD)',
    }),
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(getFeesChart(args), error, 'Got expected error');
    } else {
      deepEqual(summary(await getFeesChart(args)), expected, 'Got chart');
    }

    return;
  });
});
