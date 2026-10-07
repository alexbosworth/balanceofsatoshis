const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {getInfoResponse} = require('./../fixtures');
const {getNodeInfoResponse} = require('./../fixtures');
const {getPending} = require('./../../network');
const {pendingChannelsResponse} = require('./../fixtures');
const {versionInfoResponse} = require('./../fixtures');

const clone = n => JSON.parse(JSON.stringify(n));
const peerA = Buffer.alloc(33).toString('hex');

const makeArgs = overrides => {
  const args = {
    fs: {getFile: ({}, cbk) => cbk()},
    is_monochrome: true,
    logger: {debug: () => {}},
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const makeLnd = ({pending}) => {
  const nodeInfo = clone(getNodeInfoResponse);

  // Node channels are not needed to look up an alias
  nodeInfo.channels = [];

  return {
    default: {
      getInfo: ({}, cbk) => cbk(null, clone(getInfoResponse)),
      getNodeInfo: ({}, cbk) => cbk(null, nodeInfo),
      listChannels: ({}, cbk) => cbk(null, {channels: []}),
      pendingChannels: ({}, cbk) => cbk(null, pending || {
        pending_closing_channels: [],
        pending_force_closing_channels: [],
        pending_open_channels: [],
        total_limbo_balance: '0',
        waiting_close_channels: [],
      }),
    },
    version: {
      getVersion: ({}, cbk) => cbk(null, versionInfoResponse),
    },
  };
};

const tests = [
  {
    args: makeArgs({fs: undefined}),
    description: 'File system methods are required to get pending items',
    error: [400, 'ExpectedFileSystemMethodsToGetPendingItems'],
  },
  {
    args: makeArgs({}),
    description: 'An array of LNDs is required to get pending items',
    error: [400, 'ExpectedArrayOfLndsToGetPendingItems'],
  },
  {
    args: makeArgs({lnds: []}),
    description: 'An LND is required to get pending items',
    error: [400, 'ExpectedAnLndToGetPendingItems'],
  },
  {
    args: makeArgs({lnds: [makeLnd({})], logger: undefined}),
    description: 'A logger is required to get pending items',
    error: [400, 'ExpectedLoggerToGetPendingItems'],
  },
  {
    args: makeArgs({lnds: [makeLnd({})], max_relays: -1}),
    description: 'A max relays count cannot be negative',
    error: [400, 'ExpectedNonNegativeMaxRelaysCountToShow'],
  },
  {
    args: makeArgs({lnds: [makeLnd({})]}),
    description: 'Nothing pending on a node is summarized',
    expected: 'No pending payments or channels',
  },
  {
    args: makeArgs({
      lnds: [makeLnd({}), makeLnd({pending: pendingChannelsResponse})],
    }),
    description: 'Pending items across nodes are summarized by node',
    expected: [
      '02000000',
      'Waiting for outbound 0.00000001 channel with alias 00000000 to confirm: 00',
    ].join('\n'),
  },
  {
    args: makeArgs({
      fs: {
        getFile: ({}, cbk) => cbk(null, JSON.stringify({
          tags: [{alias: 'tag', icon: '🚀', id: 'id', nodes: [peerA]}],
        })),
      },
      lnds: [makeLnd({pending: pendingChannelsResponse})],
    }),
    description: 'Tagged nodes are shown with their tag icons',
    expected: 'Waiting for outbound 0.00000001 channel with 🚀 alias 00000000 to confirm: 00',
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(getPending(args), error, 'Got expected error');
    } else {
      const summary = await getPending(args);

      deepEqual(summary, expected, 'Got expected pending summary');
    }

    return;
  });
});
