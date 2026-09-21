const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const asyncUntil = require('async/until');
const {getChannel} = require('ln-service');
const {getNode} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const relayPolicyIssue = require('./relay_policy_issue');
const selectNextHop = require('./select_next_hop');

const blindingBits = [24, 25];
const {isArray} = Array;
const isBlinding = features => features.some(n => blindingBits.includes(n.bit));
const isPublicKey = n => /^0[2-3][0-9A-F]{64}$/i.test(n);
const matches = (n, q) => text(n).includes(q);
const minPathHops = 2;
const nodeName = node => node.alias || node.public_key;
const notFound = 404;
const notBlindingIssue = 'peer does not advertise route blinding support';
const notInGraphIssue = 'peer is not found in the network graph';
const pageSize = 15;
const text = n => `${n.name} ${n.description}`.toLowerCase();
const tokensAsBigUnit = tokens => (tokens / 1e8).toFixed(8);
const uniq = arr => Array.from(new Set(arr));

/** Select a blinded path by walking outwards from a peer to an intro node

  {
    ask: <Inquirer Function>
    channels: [{
      id: <Standard Format Channel Id String>
      local_balance: <Local Balance Tokens Number>
      partner_public_key: <Peer Public Key Hex String>
      remote_balance: <Remote Balance Tokens Number>
    }]
    lnd: <Authenticated LND API Object>
    [max_hops]: <Maximum Path Hops Including Own Node Number>
    mtokens: <Payment Millitokens String>
    public_key: <Own Node Public Key Hex String>
  }

  @returns via cbk or Promise
  {
    channels: [{
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
    }]
    introduction_node: <Introduction Node Public Key Hex String>
  }

  `channels` are ordered from the introduction node towards the own node
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.ask) {
          return cbk([400, 'ExpectedAskFunctionToSelectBlindedPath']);
        }

        if (!isArray(args.channels)) {
          return cbk([400, 'ExpectedArrayOfChannelsToSelectBlindedPath']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToSelectBlindedPath']);
        }

        if (!!args.max_hops && args.max_hops < minPathHops) {
          return cbk([400, 'ExpectedMaxHopsToAllowForPeerAndOwnNodeInPath']);
        }

        if (!args.mtokens) {
          return cbk([400, 'ExpectedPaymentMillitokensToSelectBlindedPath']);
        }

        if (!isPublicKey(args.public_key)) {
          return cbk([400, 'ExpectedOwnPublicKeyToSelectBlindedPath']);
        }

        return cbk();
      },

      // Get the policies of the channels with peers
      getPolicies: ['validate', ({}, cbk) => {
        return asyncMap(args.channels, (channel, cbk) => {
          return getChannel({id: channel.id, lnd: args.lnd}, (err, res) => {
            const details = {
              id: channel.id,
              local_balance: channel.local_balance,
              partner_public_key: channel.partner_public_key,
              remote_balance: channel.remote_balance,
            };

            // Exit early when the channel details are not known
            if (isArray(err) && err.slice().shift() === notFound) {
              return cbk(null, {
                ...details,
                issue: 'channel details are not found',
              });
            }

            if (!!err) {
              return cbk(err);
            }

            const policy = res.policies.find(policy => {
              return policy.public_key === channel.partner_public_key;
            });

            const {issue} = relayPolicyIssue({policy, mtokens: args.mtokens});

            return cbk(null, {...details, issue, policies: res.policies});
          });
        },
        cbk);
      }],

      // Get the details of the peers
      getPeers: ['getPolicies', ({getPolicies}, cbk) => {
        const ids = uniq(getPolicies.map(n => n.partner_public_key));

        return asyncMap(ids, (id, cbk) => {
          return getNode({
            is_omitting_channels: true,
            lnd: args.lnd,
            public_key: id,
          },
          (err, res) => {
            // Exit early when the peer is not in the graph
            if (isArray(err) && err.slice().shift() === notFound) {
              return cbk(null, {issue: notInGraphIssue, public_key: id});
            }

            if (!!err) {
              return cbk(err);
            }

            // Exit early when the peer cannot relay in a blinded path
            if (!isBlinding(res.features)) {
              return cbk(null, {
                alias: res.alias,
                issue: notBlindingIssue,
                public_key: id,
              });
            }

            return cbk(null, {alias: res.alias, public_key: id});
          });
        },
        cbk);
      }],

      // Select the peer channel that the payment is received over
      selectPeer: [
        'getPeers',
        'getPolicies',
        ({getPeers, getPolicies}, cbk) =>
      {
        const channels = getPolicies.map(channel => {
          const node = getPeers.find(peer => {
            return peer.public_key === channel.partner_public_key;
          });

          // A channel is unusable when it or its peer has an issue
          return {channel, node, issue: channel.issue || node.issue};
        });

        const hops = channels.filter(n => !n.issue);

        // Make sure there are some peer channels to start the path from
        if (!hops.length) {
          return cbk([400, 'NoRelevantChannelsToSelectAsEncryptedHints', {
            channels: channels.map(({channel, issue, node}) => ({
              issue,
              id: channel.id,
              peer: nodeName(node),
            })),
          }]);
        }

        // Unusable channels are shown disabled with the reason they cannot be
        const choices = channels.map(({channel, issue, node}) => {
          const inbound = `in: ${tokensAsBigUnit(channel.remote_balance)}`;
          const outbound = `out: ${tokensAsBigUnit(channel.local_balance)}`;

          return {
            description: node.public_key,
            disabled: !issue ? false : `(${issue})`,
            name: `${channel.id} ${nodeName(node)}: ${inbound} | ${outbound}.`,
            value: channel.id,
          };
        });

        return args.ask({
          pageSize,
          message: 'Peer to receive the payment through?',
          name: 'id',
          source: term => {
            return choices.filter(n => !term || matches(n, term.toLowerCase()));
          },
          type: 'search',
        },
        ({id}) => {
          const hop = hops.find(n => n.channel.id === id);

          if (!hop) {
            return cbk([400, 'ExpectedKnownChannelSelectedForBlindedPath']);
          }

          return cbk(null, {
            alias: hop.node.alias,
            channel: {id: hop.channel.id, policies: hop.channel.policies},
            public_key: hop.node.public_key,
          });
        });
      }],

      // Extend the path outwards until the introduction node is selected
      extendPath: ['selectPeer', ({selectPeer}, cbk) => {
        const path = [selectPeer];
        let isDone = false;

        return asyncUntil(
          cbk => cbk(null, isDone),
          cbk => {
            const [node] = path.slice().reverse();

            // The path hops are the selected relaying nodes plus the own node
            const hops = path.length + [args.public_key].length;

            return selectNextHop({
              node,
              ask: args.ask,
              excluded: [args.public_key].concat(path.map(n => n.public_key)),
              is_max_length: !!args.max_hops && hops >= args.max_hops,
              lnd: args.lnd,
              mtokens: args.mtokens,
            },
            (err, res) => {
              if (!!err) {
                return cbk(err);
              }

              // Exit early when the last node is the introduction node
              if (!res.hop) {
                isDone = true;

                return cbk();
              }

              path.push(res.hop);

              return cbk();
            });
          },
          err => !!err ? cbk(err) : cbk(null, {path}),
        );
      }],

      // The path channels are ordered from the introduction node inwards
      path: ['extendPath', ({extendPath}, cbk) => {
        const [introduction] = extendPath.path.slice().reverse();

        return cbk(null, {
          channels: extendPath.path.slice().reverse().map(n => n.channel),
          introduction_node: introduction.public_key,
        });
      }],
    },
    returnResult({reject, resolve, of: 'path'}, cbk));
  });
};
