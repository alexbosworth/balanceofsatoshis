const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {getInfoResponse} = require('./../fixtures');
const getOutPeers = require('./../../network/get_out_peers');
const {getNodeInfoResponse} = require('./../fixtures');
const {listChannelsResponse} = require('./../fixtures');
const {versionInfoResponse} = require('./../fixtures');

const alice = Buffer.alloc(33, 2).toString('hex');
const bob = Buffer.alloc(33, 3).toString('hex');
const carol = Buffer.alloc(33, 4).toString('hex');
const dave = Buffer.alloc(33, 5).toString('hex');
const erin = Buffer.alloc(33, 6).toString('hex');
const identity = getInfoResponse.identity_pubkey;
const tagId = n => Buffer.alloc(32, n).toString('hex');

// Alice has high outbound, Bob has low outbound, Carol is inactive
// Erin is untagged with an alias that contains the name of a tag
const peers = [
  {active: true, fee_rate: 10, id: '1', key: alice, local: 9e6, remote: 1e6},
  {active: true, fee_rate: 900, id: '2', key: bob, local: 1e6, remote: 9e6},
  {active: false, fee_rate: 10, id: '3', key: carol, local: 9e6, remote: 1e6},
  {active: true, fee_rate: 10, id: '4', key: erin, local: 1e6, remote: 1e6},
];

const aliases = {
  [alice]: 'alice',
  [bob]: 'bob',
  [carol]: 'carol',
  [erin]: 'inactive-relay',
};

const policy = rate => ({
  ...getNodeInfoResponse.channels[0].node1_policy,
  fee_rate_milli_msat: String(rate),
});

const makeLnd = ({is_missing_policies}) => ({
  default: {
    getInfo: ({}, cbk) => cbk(null, getInfoResponse),
    getNodeInfo: ({pub_key}, cbk) => {
      // The node itself can be missing from the graph
      if (pub_key === identity && !!is_missing_policies) {
        return cbk({details: 'unable to find node'});
      }

      // The node itself has channels that show the peer policies
      const channels = pub_key !== identity ? [] : peers.map(peer => ({
        ...getNodeInfoResponse.channels[0],
        channel_id: peer.id,
        node1_policy: policy(1),
        node1_pub: identity,
        node2_policy: policy(peer.fee_rate),
        node2_pub: peer.key,
      }));

      return cbk(null, {
        ...getNodeInfoResponse,
        channels,
        node: {
          ...getNodeInfoResponse.node,
          alias: aliases[pub_key] || String(),
          pub_key,
        },
      });
    },
    listChannels: ({}, cbk) => cbk(null, {
      channels: peers.map(peer => ({
        ...listChannelsResponse.channels[0],
        active: peer.active,
        capacity: String(peer.local + peer.remote),
        chan_id: peer.id,
        local_balance: String(peer.local),
        remote_balance: String(peer.remote),
        remote_pubkey: peer.key,
      })),
    }),
  },
  version: {getVersion: ({}, cbk) => cbk(null, versionInfoResponse)},
});

const makeFs = tags => ({
  getFile: ({}, cbk) => cbk(null, Buffer.from(JSON.stringify({tags}))),
});

const tags = [
  {alias: 'group', id: tagId(1), nodes: [alice, bob, carol, dave]},
  {alias: 'inactive', id: tagId(2), nodes: [carol]},
  {alias: 'dupe', id: tagId(3), nodes: [alice]},
  {alias: 'dupe', id: tagId(4), nodes: [bob]},
];

const makeArgs = overrides => {
  const args = {fs: makeFs(tags), lnd: makeLnd({}), out: []};

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({lnd: undefined}),
    description: 'Getting out peers requires lnd',
    error: [400, 'ExpectedAuthenticatedLndToGetOutPeers'],
  },
  {
    args: makeArgs({out: undefined}),
    description: 'Getting out peers requires an array of out queries',
    error: [400, 'ExpectedArrayOfOutQueriesToGetOutPeers'],
  },
  {
    args: makeArgs({out: ['']}),
    description: 'Getting out peers requires non-empty queries',
    error: [400, 'ExpectedNonEmptyOutQueriesToGetOutPeers'],
  },
  {
    args: makeArgs({filters: 'filter'}),
    description: 'Getting out peers requires an array of filters',
    error: [400, 'ExpectedArrayOfOutFiltersToGetOutPeers'],
  },
  {
    args: makeArgs({filters: ['outbound_liquidity > 0']}),
    description: 'Filters require out peers to filter',
    error: [400, 'NoPeerMatchesFoundToSatisfyOutboundFilter'],
  },
  {
    args: makeArgs({lnd: {}}),
    description: 'No out peers are returned when there are no out queries',
    expected: {public_keys: []},
  },
  {
    args: makeArgs({out: [alice, bob, alice]}),
    description: 'Public keys are returned as out peers',
    expected: {public_keys: [alice, bob]},
  },
  {
    args: makeArgs({out: ['bob']}),
    description: 'An alias is resolved to an out peer',
    expected: {public_keys: [bob]},
  },
  {
    args: makeArgs({out: ['group']}),
    description: 'A tag alias is expanded to all active tagged peers',
    expected: {public_keys: [alice, bob]},
  },
  {
    args: makeArgs({out: [tagId(1).slice(0, 8)]}),
    description: 'A tag id prefix is expanded to all active tagged peers',
    expected: {public_keys: [alice, bob]},
  },
  {
    args: makeArgs({out: ['GROUP', bob]}),
    description: 'Tags and public keys are combined without duplicates',
    expected: {public_keys: [alice, bob]},
  },
  {
    args: makeArgs({filters: ['outbound_liquidity > 5*m'], out: ['group']}),
    description: 'A tag is filtered down to the tagged peers matching filters',
    expected: {public_keys: [alice]},
  },
  {
    args: makeArgs({filters: ['inbound_fee_rate > 100'], out: ['group']}),
    description: 'A tag is filtered using the fee rates of peers',
    expected: {public_keys: [bob]},
  },
  {
    args: makeArgs({
      filters: ['outbound_liquidity > 5*m'],
      lnd: makeLnd({is_missing_policies: true}),
      out: ['group'],
    }),
    description: 'Policies are not fetched for filters without fee variables',
    expected: {public_keys: [alice]},
  },
  {
    args: makeArgs({
      filters: ['INBOUND_FEE_RATE > 100'],
      lnd: makeLnd({is_missing_policies: true}),
      out: ['group'],
    }),
    description: 'Policies are fetched for filters with fee variables',
    error: [404, 'NodeIsUnknown'],
  },
  {
    args: makeArgs({filters: ['capacity > 1*btc'], out: ['group']}),
    description: 'A tag with no peers satisfying the filters is an error',
    error: [400, 'NoPeerMatchesFoundToSatisfyOutboundFilter'],
  },
  {
    args: makeArgs({out: ['inactive']}),
    description: 'A tag with no active peers is an error',
    error: [400, 'NoActivePeersFoundForOutTag', {query: 'inactive'}],
  },
  {
    args: makeArgs({filters: ['capacity > 0'], out: ['inactive']}),
    description: 'A tag with no active peers and filters is an error',
    error: [400, 'NoActivePeersFoundForOutTag', {query: 'inactive'}],
  },
  {
    args: makeArgs({out: ['inactive-relay']}),
    description: 'An alias containing the name of a tag is resolved',
    expected: {public_keys: [erin]},
  },
  {
    args: makeArgs({filters: ['outbound_liquidity > 5*m'], out: [alice]}),
    description: 'A public key is returned when it matches filters',
    expected: {public_keys: [alice]},
  },
  {
    args: makeArgs({filters: ['outbound_liquidity > 5*m'], out: [bob]}),
    description: 'A public key that does not match filters is an error',
    error: [400, 'NoPeerMatchesFoundToSatisfyOutboundFilter'],
  },
  {
    args: makeArgs({filters: ['invalid formula'], out: ['group']}),
    description: 'An invalid filter formula is an error',
    error: [400, 'FailedToParseFilter', {
      error: 'UnexpectedTrailingTokenForFormulaParsing',
      formula: 'invalid formula',
    }],
  },
  {
    args: makeArgs({out: ['dupe']}),
    description: 'An ambiguous tag is an error',
    error: [400, 'MultipleTagMatchesFoundForOutPeer', {
      matches: [tags[2], tags[3]],
    }],
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(getOutPeers(args), error, 'Got expected error');
    } else {
      const res = await getOutPeers(args);

      deepEqual(
        {public_keys: res.public_keys.slice().sort()},
        {public_keys: expected.public_keys.slice().sort()},
        'Got expected out peers'
      );
    }

    return;
  });
});
