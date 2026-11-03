const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {getNodeInfoResponse} = require('./../fixtures');
const method = require('./../../network/get_out_queries');

const bufferAsHex = buffer => Buffer.from(buffer).toString('hex');

const alice = bufferAsHex(Buffer.alloc(33, 3));
const bob = bufferAsHex(Buffer.alloc(33, 2));
const carol = bufferAsHex(Buffer.alloc(33, 4));
const dave = bufferAsHex(Buffer.alloc(33, 5));
const friendsId = bufferAsHex(Buffer.alloc(32));
const otherId = bufferAsHex(Buffer.alloc(32, 255));

const otherPrefix = otherId.slice(Number(), 4);

// The aliases of the nodes
const aliases = {
  [alice]: 'alice',
  [bob]: 'bob',
  [carol]: 'carol',
  [dave]: 'dave',
};

// Make a LND that looks up the aliases of nodes after a delay
const makeLnd = ({}) => {
  return {
    default: {
      getNodeInfo: ({pub_key}, cbk) => setImmediate(() => cbk(null, {
        ...getNodeInfoResponse,
        channels: [],
        node: {...getNodeInfoResponse.node, pub_key, alias: aliases[pub_key]},
        num_channels: '0',
      })),
    },
  };
};

// Make arguments with channels to alice, bob and dave, where bob and carol,
// who is not a peer, are friends, and alice is in a tag that has no alias
const makeArgs = overrides => {
  const args = {
    channels: [alice, bob, dave].map(key => ({partner_public_key: key})),
    lnd: makeLnd({}),
    out: [],
    tags: [
      {alias: 'friends', id: friendsId, nodes: [bob, carol]},
      {id: otherId, nodes: [alice]},
    ],
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

// Make the expected result, there are no out peers without out queries
const makeExpected = overrides => {
  const expected = {public_keys: [], queries: []};

  Object.keys(overrides).forEach(k => expected[k] = overrides[k]);

  return expected;
};

const tests = [
  {
    args: makeArgs({channels: undefined}),
    description: 'Channels are required',
    error: [400, 'ExpectedArrayOfChannelsToGetOutQueries'],
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is required',
    error: [400, 'ExpectedAuthenticatedLndToGetOutQueries'],
  },
  {
    args: makeArgs({out: undefined}),
    description: 'Out queries are required',
    error: [400, 'ExpectedArrayOfOutPeersToGetOutQueries'],
  },
  {
    args: makeArgs({tags: undefined}),
    description: 'Tags are required',
    error: [400, 'ExpectedArrayOfTagsToGetOutQueries'],
  },
  {
    args: makeArgs({out: ['nobody']}),
    description: 'An alias has to match a peer',
    error: [400, 'FailedToFindPeerAliasMatch', {not_found: 'nobody'}],
  },
  {
    args: makeArgs({out: ['a']}),
    description: 'An alias has to match only one peer',
    error: [400, 'AmbiguousAliasSpecified', {
      matching: [
        {alias: 'alice', public_key: alice},
        {alias: 'dave', public_key: dave},
      ],
    }],
  },
  {
    args: makeArgs({}),
    description: 'No out queries means no out peers',
    expected: makeExpected({}),
  },
  {
    args: makeArgs({
      out: ['ALICE', 'Friends', bob.toUpperCase(), otherPrefix],
    }),
    description: 'Aliases resolve to keys while tags are kept as tags',
    expected: makeExpected({
      // Carol is a friend but she is not a peer to go out through
      public_keys: [alice, bob],
      queries: [alice, 'Friends', bob, otherPrefix],
    }),
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(method(args), error, 'Got expected error');
    } else {
      deepEqual(await method(args), expected, 'Got expected out queries');
    }

    return;
  });
});
