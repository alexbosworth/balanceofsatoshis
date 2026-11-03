const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {getNodeInfoResponse} = require('./../fixtures');
const method = require('./../../display/describe_routing_failure');

const bufferAsHex = buffer => Buffer.from(buffer).toString('hex');

const alice = bufferAsHex(Buffer.alloc(33, 3));
const bob = bufferAsHex(Buffer.alloc(33, 2));
const carol = bufferAsHex(Buffer.alloc(33, 4));

// Make a LND that looks up the aliases of nodes after a delay
const makeLnd = ({}) => {
  const aliases = {[alice]: 'alice', [bob]: 'bob', [carol]: 'carol'};

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

// Make arguments for a failure on a route out through bob and carol to alice
const makeArgs = overrides => {
  const args = {
    index: 1,
    lnd: makeLnd({}),
    reason: 'ChannelDisabled',
    route: {
      hops: [
        {channel: '0x0x1', public_key: bob},
        {channel: '0x0x2', public_key: carol},
        {channel: '0x0x3', public_key: alice},
      ],
    },
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

// Make the expected description of the failure at bob forwarding to carol
const makeExpected = overrides => {
  const expected = {
    description: 'ChannelDisabled from bob on 0x0x2 forwarding to carol',
  };

  Object.keys(overrides).forEach(k => expected[k] = overrides[k]);

  return expected;
};

const tests = [
  {
    args: makeArgs({index: undefined}),
    description: 'The index of the failure is required',
    error: [400, 'ExpectedIndexToDescribeRoutingFailure'],
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is required',
    error: [400, 'ExpectedLndApiObjectToDescribeRoutingFailure'],
  },
  {
    args: makeArgs({reason: undefined}),
    description: 'A failure reason is required',
    error: [400, 'ExpectedFailureReasonToDescribeRoutingFailure'],
  },
  {
    args: makeArgs({route: undefined}),
    description: 'The route that failed is required',
    error: [400, 'ExpectedFailedRouteToDescribeRoutingFailure'],
  },
  {
    args: makeArgs({tagged: 'tagged'}),
    description: 'Tagged nodes are an array',
    error: [400, 'ExpectedArrayOfTaggedNodesForFailureDescription'],
  },
  {
    args: makeArgs({}),
    description: 'A failure on the way names the channel and both its nodes',
    expected: makeExpected({}),
  },
  {
    args: makeArgs({index: 0}),
    description: 'A failure at the first hop has no node it comes from',
    expected: makeExpected({
      description: 'ChannelDisabled  on 0x0x1 forwarding to bob',
    }),
  },
  {
    args: makeArgs({index: 3, reason: 'UnknownPaymentHash'}),
    description: 'A failure at the destination names only the destination',
    expected: makeExpected({description: 'UnknownPaymentHash from alice'}),
  },
  {
    args: makeArgs({tagged: [{icons: ['🐢'], public_key: bob}]}),
    description: 'A tagged node is shown with its icon',
    expected: makeExpected({
      description: 'ChannelDisabled from 🐢 bob on 0x0x2 forwarding to carol',
    }),
  },
  {
    args: makeArgs({tagged: [{icons: ['🐢'], public_key: carol}]}),
    description: 'A tagged node it forwards to is shown with its icon',
    expected: makeExpected({
      description: 'ChannelDisabled from bob on 0x0x2 forwarding to 🐢 carol',
    }),
  },
  {
    args: makeArgs({route: {hops: [{channel: '0x0x1'}, {channel: '0x0x2'}]}}),
    description: 'Hops without public keys are left out of the description',
    expected: makeExpected({description: 'ChannelDisabled  on 0x0x2'}),
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(method(args), error, 'Got expected error');
    } else {
      deepEqual(await method(args), expected, 'Got expected description');
    }

    return;
  });
});
