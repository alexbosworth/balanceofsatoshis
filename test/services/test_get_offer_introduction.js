const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const method = require('./../../services/get_offer_introduction');
const {getNodeInfoResponse} = require('./../fixtures');
const {listChannelsResponse} = require('./../fixtures');
const {listPeersResponse} = require('./../fixtures');

const alice = Buffer.alloc(33, 2).toString('hex');
const bob = Buffer.alloc(33, 3).toString('hex');
const carol = Buffer.alloc(33, 4).toString('hex');
const dave = Buffer.alloc(33, 5).toString('hex');
const relayFeature = {39: {is_known: true, is_required: false, name: 'msgs'}};

// An LND with channels to peers, which peers relay, and which are public
const makeLnd = ({channels, nodes, relays}) => {
  const [channel] = listChannelsResponse.channels;
  const [peer] = listPeersResponse.peers;

  return {
    default: {
      getNodeInfo: (args, cbk) => {
        // A node that is not in the graph is not found
        if (nodes[args.pub_key] === undefined) {
          return cbk({details: 'unable to find node'});
        }

        return cbk(null, {
          ...getNodeInfoResponse,
          channels: [],
          node: {...getNodeInfoResponse.node, pub_key: args.pub_key},
          num_channels: nodes[args.pub_key],
        });
      },
      listChannels: ({}, cbk) => cbk(null, {
        channels: channels.map((n, i) => ({
          ...channel,
          active: n.active !== false,
          capacity: String(n.capacity),
          chan_id: String(i + 1),
          private: n.private !== false,
          remote_pubkey: n.key,
        })),
      }),
      listPeers: ({}, cbk) => cbk(null, {
        peers: channels.map(n => ({
          ...peer,
          features: relays.includes(n.key) ? relayFeature : {},
          pub_key: n.key,
        })),
      }),
    },
  };
};

const tests = [
  {
    args: {},
    description: 'An LND is required to get an offer introduction',
    error: [400, 'ExpectedAuthenticatedLndToGetOfferIntroduction'],
  },
  {
    args: {
      lnd: makeLnd({
        channels: [{capacity: 1e6, key: alice, private: false}],
        nodes: {},
        relays: [],
      }),
    },
    description: 'A node with a public channel starts the path at itself',
    expected: {},
  },
  {
    args: {
      lnd: makeLnd({
        channels: [
          {capacity: 1e6, key: alice},
          {capacity: 5e6, key: bob},
          {capacity: 9e6, key: carol},
          {active: false, capacity: 8e6, key: dave},
        ],
        nodes: {[alice]: 3, [bob]: 2, [carol]: 4, [dave]: 5},
        relays: [alice, bob, dave],
      }),
    },
    description: 'A private node starts the path at its largest relay peer',
    expected: {introduction: bob},
  },
  {
    args: {
      lnd: makeLnd({
        channels: [{capacity: 1e6, key: alice}, {capacity: 5e6, key: bob}],
        nodes: {[alice]: 3},
        relays: [alice, bob],
      }),
    },
    description: 'A peer that is not in the graph is not used',
    expected: {introduction: alice},
  },
  {
    args: {
      lnd: makeLnd({
        channels: [{capacity: 1e6, key: alice}, {capacity: 5e6, key: bob}],
        nodes: {[alice]: 3, [bob]: 0},
        relays: [alice, bob],
      }),
    },
    description: 'A peer without public channels is not used',
    expected: {introduction: alice},
  },
  {
    args: {
      lnd: makeLnd({
        channels: [{capacity: 1e6, key: alice}],
        nodes: {[alice]: 3},
        relays: [],
      }),
    },
    description: 'A private node needs a public peer that relays messages',
    error: [503, 'ExpectedPublicPeerToStartPrivateNodeOfferPath'],
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(method(args), error, 'Got expected error');
    } else {
      deepEqual(await method(args), expected, 'Got expected introduction');
    }

    return;
  });
});
