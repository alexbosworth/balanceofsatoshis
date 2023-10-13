const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {getPeers} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const {isArray} = Array;

/** Get the peers for nodes

  {
    lnd: <Authenticated LND API Objects>
    nodes: [{
      lnd: <Authenticated LND API Object>
      node: <Node Name String>
    }]
  }

  @returns via cbk or Promise
  {
    nodes: [{
      [node]: <Node Name String>
      peers: [{
        features: [{
          type: <Feature Type String>
        }]
        public_key: <Node Identity Public Key Hex String>
      }]
    }]
  }
*/
module.exports = ({lnd, nodes}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToGetPeersForNodes']);
        }

        if (!isArray(nodes)) {
          return cbk([400, 'ExpectedArrayOfNodesToGetPeersForNodes']);
        }

        return cbk();
      },

      // Get multiple nodes peers
      getMultiplePeers: ['validate', ({}, cbk) => {
        // Exit early when there is only a single node to get the peers for
        if (!nodes.length) {
          return cbk();
        }

        // For all of the multiple nodes get their peers list
        return asyncMap(nodes, ({lnd, node}, cbk) => {
          return getPeers({lnd}, (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            return cbk(null, {node, peers: res.peers});
          });
        },
        cbk);
      }],

      // Get the peers list for a single node
      getSinglePeers: ['validate', ({}, cbk) => {
        // Exit early when there are multiple nodes to get the peers for
        if (!!nodes.length) {
          return cbk();
        }

        return getPeers({lnd}, cbk);
      }],

      // Final set of peers for a node or nodes
      peers: [
        'getMultiplePeers',
        'getSinglePeers',
        ({getMultiplePeers, getSinglePeers}, cbk) =>
      {
        return cbk(null, getMultiplePeers || [{peers: getSinglePeers.peers}]);
      }],
    },
    returnResult({reject, resolve, of: 'peers'}, cbk));
  });
};
