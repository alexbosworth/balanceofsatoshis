const {addPeer} = require('ln-service');
const asyncAuto = require('async/auto');
const asyncDetectSeries = require('async/detectSeries');
const asyncFilterLimit = require('async/filterLimit');
const {returnResult} = require('asyncjs-util');

const {isArray} = Array;

/** Connect to a set of nodes

  {
    limit: <Simultaneous Connect Limit Number>
    lnd: <Authenticated LND API Object>
    nodes: [{
      public_key: <Node Identity Public Key Hex String>
      sockets: [<Node Socket String>]
    }]
    [retries]: <Retry Count Number>
  }

  @returns via cbk or Promise
  {
    connected: [{
      public_key: <Node Identity Public Key Hex String>
      sockets: [<Node Socket String>]
    }]
  }
*/
module.exports = ({limit, lnd, nodes, retries}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!limit) {
          return cbk([400, 'ExpectedLimitToConnectToNodes']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndApiToConnectToNodes']);
        }

        if (!isArray(nodes)) {
          return cbk([400, 'ExpectedArrayOfNodesToConnectTo']);
        }

        return cbk();
      },

      // Connect to nodes
      connect: ['validate', ({}, cbk) => {
        return asyncFilterLimit(nodes, limit, (node, cbk) => {
          return asyncDetectSeries(node.sockets, ({socket}, cbk) => {
            return addPeer({
              lnd,
              socket,
              public_key: node.public_key,
              retry_count: retries,
            },
            err => cbk(null, !err));
          },
          cbk);
        },
        cbk);
      }],

      // Final set of reconnected nodes
      connected: ['connect', ({connect}, cbk) => {
        return cbk(null, {connected: connect});
      }],
    },
    returnResult({reject, resolve, of: 'connected'}, cbk));
  });
};
