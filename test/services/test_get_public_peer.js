const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const method = require('./../../services/get_public_peer');
const {getNodeInfoResponse} = require('./../fixtures');

const alice = Buffer.alloc(33, 2).toString('hex');
const bob = Buffer.alloc(33, 3).toString('hex');
const carol = Buffer.alloc(33, 4).toString('hex');

// An LND with a graph of nodes and their counts of public channels
const makeLnd = ({nodes}) => {
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
    },
  };
};

const tests = [
  {
    args: {peers: []},
    description: 'An LND is required to get a public peer',
    error: [400, 'ExpectedAuthenticatedLndToGetPublicPeer'],
  },
  {
    args: {lnd: makeLnd({nodes: {}})},
    description: 'Peers are required to get a public peer',
    error: [400, 'ExpectedArrayOfPeersToGetPublicPeer'],
  },
  {
    args: {
      lnd: makeLnd({nodes: {[bob]: 0, [carol]: 2}}),
      peers: [alice, bob, carol],
    },
    description: 'The first peer with public channels in the graph is found',
    expected: {public_key: carol},
  },
  {
    args: {lnd: makeLnd({nodes: {[bob]: 0}}), peers: [alice, bob]},
    description: 'There is no public peer when none have public channels',
    expected: {public_key: undefined},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(method(args), error, 'Got expected error');
    } else {
      deepEqual(await method(args), expected, 'Got expected public peer');
    }

    return;
  });
});
