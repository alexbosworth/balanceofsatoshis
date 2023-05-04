const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {getNode} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const {isArray} = Array;

/** Get a graph for specific nodes

  {
    lnd: <Authenticated LND API Object>
    nodes: [<Node Identity Public Key Hex String>]
  }

  @returns via cbk or Promise
  {
    channels: [{
      capacity: <Channel Capacity Tokens Number>
      id: <Standard Format Channel Id String>
      policies: [{
        [base_fee_mtokens]: <Bae Fee Millitokens String>
        [cltv_delta]: <CLTV Height Delta Number>
        [fee_rate]: <Fee Rate In Millitokens Per Million Number>
        [is_disabled]: <Edge is Disabled Bool>
        [max_htlc_mtokens]: <Maximum HTLC Millitokens String>
        [min_htlc_mtokens]: <Minimum HTLC Millitokens String>
        public_key: <Public Key String>
        [updated_at]: <Last Update Epoch ISO 8601 Date String>
      }]
      transaction_id: <Funding Transaction Id String>
      transaction_vout: <Funding Transaction Output Index Number>
      [updated_at]: <Last Update Epoch ISO 8601 Date String>
    }]
    nodes: [{
      alias: <Name String>
      color: <Hex Encoded Color String>
      features: [{
        bit: <BOLT 09 Feature Bit Number>
        is_known: <Feature is Known Bool>
        is_required: <Feature Support is Required Bool>
        type: <Feature Type String>
      }]
      public_key: <Node Public Key String>
      updated_at: <Last Updated ISO 8601 Date String>
    }]
  }
*/
module.exports = ({lnd, nodes}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToGetNodesGraph']);
        }

        if (!isArray(nodes)) {
          return cbk([400, 'ExpectedArrayOfNodeIdsToGetNodesGraph']);
        }

        return cbk();
      },

      // Get node identity details
      getNodes: ['validate', ({}, cbk) => {
        return asyncMap(nodes, (id, cbk) => {
          return getNode({lnd, public_key: id}, (err, res) => {
            const [code] = err || [];

            // Exit early when node is not known
            if (code === 404) {
              return cbk();
            }

            if (!!err) {
              return cbk(err);
            }

            return cbk(null, {
              alias: res.alias,
              channels: res.channels,
              color: res.color,
              features: res.features,
              public_key: id,
              updated_at: res.updated_at,
            });
          });
        },
        cbk);
      }],

      // Separate nodes and channels
      graph: ['getNodes', ({getNodes}, cbk) => {
        const allNodes = getNodes.filter(n => !!n);
        const channels = [];
        const ids = {};

        // Populate the channels list
        allNodes.forEach(node => {
          return node.channels.forEach(channel => {
            // Exit early when this channel was seen already
            if (!!ids[channel.id]) {
              return;
            }

            ids[channel.id] = true;

            return channels.push(channel);
          });
        });

        const nodes = allNodes.map(node => ({
          alias: node.alias,
          color: node.color,
          features: node.features,
          public_key: node.public_key,
          updated_at: node.updated_at,
        }));

        return cbk(null, {channels, nodes});
      }],
    },
    returnResult({reject, resolve, of: 'graph'}, cbk));
  });
};
