const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {getInfoResponse} = require('./../fixtures');
const {listChannelsResponse} = require('./../fixtures');
const method = require('./../../network/get_out_channels');

const bufferAsHex = buffer => Buffer.from(buffer).toString('hex');
const {stringify} = JSON;

const drained = bufferAsHex(Buffer.alloc(33, 2));
const peer = bufferAsHex(Buffer.alloc(33, 3));
const tagId = bufferAsHex(Buffer.alloc(32));

// Make a LND that has a channel with a peer, and with a peer that is drained,
// where the channels of inactive peers are not active
const makeLnd = ({inactive}) => {
  const isActive = key => !(inactive || []).includes(key);

  return {
    default: {
      getInfo: ({}, cbk) => cbk(null, getInfoResponse),
      listChannels: ({}, cbk) => cbk(null, {
        channels: [
          {
            ...listChannelsResponse.channels[0],
            active: isActive(peer),
            capacity: '1000000',
            chan_id: '1',
            local_balance: '900000',
            remote_balance: '100000',
            remote_pubkey: peer,
          },
          {
            ...listChannelsResponse.channels[0],
            active: isActive(drained),
            capacity: '1000000',
            chan_id: '2',
            local_balance: '100000',
            remote_balance: '900000',
            remote_pubkey: drained,
          },
        ],
      }),
    },
  };
};

const makeArgs = overrides => {
  const args = {
    fs: {getFile: (path, cbk) => cbk('err')},
    lnd: makeLnd({}),
    out: [peer],
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

// Make the expected result of going out through the peer, only results that
// restrict going out have channels to go out through
const makeExpected = overrides => {
  const expected = {public_keys: [peer]};

  Object.keys(overrides).forEach(k => expected[k] = overrides[k]);

  return expected;
};

// File system methods that read a tag of friends, the drained peer
const withFriends = {
  getFile: (path, cbk) => cbk(null, stringify({
    tags: [{alias: 'friends', id: tagId, nodes: [drained]}],
  })),
};

const tests = [
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is required',
    error: [400, 'ExpectedAuthenticatedLndToGetOutChannels'],
  },
  {
    args: makeArgs({out: undefined}),
    description: 'Out peers are required',
    error: [400, 'ExpectedArrayOfOutPeersToGetOutChannels'],
  },
  {
    args: makeArgs({lnd: makeLnd({inactive: [drained, peer]})}),
    description: 'An out peer must have an active channel',
    error: [404, 'NoActiveChannelWithOutgoingPeer'],
  },
  {
    args: makeArgs({
      fs: withFriends,
      lnd: makeLnd({inactive: [drained]}),
      out: ['friends'],
    }),
    description: 'No out peer with an active channel left is an error',
    error: [404, 'NoActiveChannelWithOutgoingPeer'],
  },
  {
    args: makeArgs({
      filters: ['OUTBOUND_LIQUIDITY > 0'],
      fs: withFriends,
      lnd: makeLnd({inactive: [drained, peer]}),
      out: ['friends', peer],
    }),
    description: 'No out peer left by the filters is a filters error',
    error: [400, 'NoPeerMatchesFoundToSatisfyOutboundFilter'],
  },
  {
    args: makeArgs({filters: ['OUTBOUND_LIQUIDITY > 1000000']}),
    description: 'An out peer must satisfy the out filters',
    error: [400, 'NoPeerMatchesFoundToSatisfyOutboundFilter'],
  },
  {
    args: makeArgs({filters: ['OUTBOUND_LIQUIDITY > 500000'], out: []}),
    description: 'Out filters need out peers to filter',
    error: [400, 'NoPeerMatchesFoundToSatisfyOutboundFilter'],
  },
  {
    args: makeArgs({
      filters: ['OUTBOUND_LIQUIDITY > 1000000'],
      out: [drained, peer],
    }),
    description: 'No out peer satisfying the filters is an error',
    error: [400, 'NoPeerMatchesFoundToSatisfyOutboundFilter'],
  },
  {
    args: makeArgs({filters: ['OUTBOUND_LIQUIDITY >'], out: [drained, peer]}),
    description: 'A filter that fails to parse is not a peer to leave out',
    error: [400, 'FailedToParseFilter'],
  },
  {
    args: makeArgs({out: []}),
    description: 'No out peers means no outbound restriction',
    expected: makeExpected({public_keys: []}),
  },
  {
    args: makeArgs({}),
    description: 'An out peer with an active channel gives its channel',
    expected: makeExpected({channels: ['0x0x1']}),
  },
  {
    args: makeArgs({filters: ['OUTBOUND_LIQUIDITY > 500000']}),
    description: 'An out peer that satisfies the filters gives its channel',
    expected: makeExpected({channels: ['0x0x1']}),
  },
  {
    args: makeArgs({
      filters: ['OUTBOUND_LIQUIDITY > 500000'],
      out: [drained, peer],
    }),
    description: 'Out peers that do not satisfy the filters are left out',
    expected: makeExpected({channels: ['0x0x1']}),
  },
  {
    args: makeArgs({
      lnd: makeLnd({inactive: [drained]}),
      out: [drained, peer],
    }),
    description: 'An out peer with no active channel is left out',
    expected: makeExpected({channels: ['0x0x1']}),
  },
  {
    args: makeArgs({
      fs: withFriends,
      lnd: makeLnd({inactive: [drained]}),
      out: ['friends', peer],
    }),
    description: 'An out tag with no active peers is left out',
    expected: makeExpected({channels: ['0x0x1']}),
  },
  {
    args: makeArgs({
      filters: ['OUTBOUND_LIQUIDITY > 0'],
      fs: withFriends,
      lnd: makeLnd({inactive: [drained]}),
      out: ['friends', peer],
    }),
    description: 'An out tag with no active peers is left out of filtering',
    expected: makeExpected({channels: ['0x0x1']}),
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(method(args), error, 'Got expected error');
    } else {
      deepEqual(await method(args), expected, 'Got expected result');
    }

    return;
  });
});
