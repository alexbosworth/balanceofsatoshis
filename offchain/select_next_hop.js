const asyncAuto = require('async/auto');
const asyncMapLimit = require('async/mapLimit');
const {getNode} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const relayPolicyIssue = require('./relay_policy_issue');

const blindingBits = [24, 25];
const byCapacity = (a, b) => b.channel.capacity - a.channel.capacity;
const introductionNode = 'introduction_node';
const {isArray} = Array;
const isBlinding = features => features.some(n => blindingBits.includes(n.bit));
const isPublicKey = n => /^0[2-3][0-9A-F]{64}$/i.test(n);
const lookupsLimit = 10;
const matches = (n, q) => text(n).includes(q);
const nodeName = node => node.alias || node.public_key;
const notFound = 404;
const pageSize = 15;
const text = n => `${n.name} ${n.description}`.toLowerCase();
const tokensAsBigUnit = tokens => (tokens / 1e8).toFixed(8);
const uniq = arr => Array.from(new Set(arr));

/** Select the next hop outwards on a blinded path or end at the last node

  {
    ask: <Inquirer Function>
    excluded: [<Excluded Node Public Key Hex String>]
    [is_max_length]: <Path Cannot Be Extended Further Bool>
    lnd: <Authenticated LND API Object>
    mtokens: <Payment Millitokens String>
    node: {
      alias: <Last Node Alias String>
      public_key: <Last Node Public Key Hex String>
    }
  }

  @returns via cbk or Promise
  {
    [hop]: {
      alias: <Relaying Node Alias String>
      channel: {
        capacity: <Maximum Tokens Number>
        id: <Standard Format Channel Id String>
        policies: [{
          [base_fee_mtokens]: <Base Fee Millitokens String>
          [cltv_delta]: <Locktime Delta Number>
          [fee_rate]: <Fees Charged in Millitokens Per Million Number>
          [is_disabled]: <Channel Is Disabled Bool>
          [max_htlc_mtokens]: <Maximum HTLC Millitokens Value String>
          [min_htlc_mtokens]: <Minimum HTLC Millitokens Value String>
          public_key: <Node Public Key String>
        }]
      }
      public_key: <Relaying Node Public Key Hex String>
    }
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.ask) {
          return cbk([400, 'ExpectedAskFunctionToSelectNextHop']);
        }

        if (!isArray(args.excluded)) {
          return cbk([400, 'ExpectedExcludedNodesToSelectNextHop']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToSelectNextHop']);
        }

        if (!args.mtokens) {
          return cbk([400, 'ExpectedPaymentMillitokensToSelectNextHop']);
        }

        if (!args.node || !isPublicKey(args.node.public_key)) {
          return cbk([400, 'ExpectedLastNodePublicKeyToSelectNextHop']);
        }

        return cbk();
      },

      // Get the channels of the last node in the path
      getChannels: ['validate', ({}, cbk) => {
        // Exit early when the path cannot be extended with more channels
        if (!!args.is_max_length) {
          return cbk(null, {channels: []});
        }

        return getNode({lnd: args.lnd, public_key: args.node.public_key}, cbk);
      }],

      // Channels where the other node has a policy that can relay the payment
      relays: ['getChannels', ({getChannels}, cbk) => {
        const relays = getChannels.channels.map(channel => {
          const [policy] = channel.policies.filter(policy => {
            return policy.public_key !== args.node.public_key;
          });

          return {channel, policy};
        });

        const relaying = relays.filter(({policy}) => {
          // Exit early when there is no other node on the channel
          if (!policy) {
            return false;
          }

          // Exit early when the node is already on the path
          if (args.excluded.includes(policy.public_key)) {
            return false;
          }

          return !relayPolicyIssue({policy, mtokens: args.mtokens}).issue;
        });

        return cbk(null, relaying);
      }],

      // Get the details of the relaying nodes
      getNodes: ['relays', ({relays}, cbk) => {
        const ids = uniq(relays.map(n => n.policy.public_key));

        return asyncMapLimit(ids, lookupsLimit, (id, cbk) => {
          return getNode({
            is_omitting_channels: true,
            lnd: args.lnd,
            public_key: id,
          },
          (err, res) => {
            // Exit early when the node is not in the graph
            if (isArray(err) && err.slice().shift() === notFound) {
              return cbk();
            }

            if (!!err) {
              return cbk(err);
            }

            return cbk(null, {
              alias: res.alias,
              features: res.features,
              public_key: id,
            });
          });
        },
        cbk);
      }],

      // Select a relaying node or end the path at the last node
      select: ['getNodes', 'relays', ({getNodes, relays}, cbk) => {
        const nodes = getNodes.filter(n => !!n && isBlinding(n.features));

        const hops = relays
          .map(({channel, policy}) => {
            const node = nodes.find(n => n.public_key === policy.public_key);

            return {channel, node, policy};
          })
          .filter(n => !!n.node)
          .sort(byCapacity);

        const choices = hops.map(({channel, node, policy}) => {
          const capacity = tokensAsBigUnit(channel.capacity);
          const fee = `${policy.base_fee_mtokens} + ${policy.fee_rate}ppm`;

          return {
            description: node.public_key,
            name: `${channel.id} ${nodeName(node)}: cap: ${capacity} | ` +
              `fee: ${fee} | cltv: ${policy.cltv_delta}`,
            value: channel.id,
          };
        });

        const end = {
          description: args.node.public_key,
          name: `Done: ${nodeName(args.node)} is the introduction node`,
          value: introductionNode,
        };

        const options = [end].concat(choices);

        // A path at its maximum length can only end at the last node
        const message = !args.is_max_length ?
          `Node that relays to ${nodeName(args.node)}?` :
          `Path is at max length, end at ${nodeName(args.node)}?`;

        return args.ask({
          message,
          pageSize,
          name: 'id',
          source: term => {
            return options.filter(n => !term || matches(n, term.toLowerCase()));
          },
          type: 'search',
        },
        ({id}) => {
          // Exit early when the last node is the introduction node
          if (id === introductionNode) {
            return cbk(null, {});
          }

          const hop = hops.find(n => n.channel.id === id);

          if (!hop) {
            return cbk([400, 'ExpectedKnownChannelSelectedForNextHop']);
          }

          return cbk(null, {
            hop: {
              alias: hop.node.alias,
              channel: hop.channel,
              public_key: hop.node.public_key,
            },
          });
        });
      }],
    },
    returnResult({reject, resolve, of: 'select'}, cbk));
  });
};
