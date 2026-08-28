const asyncAuto = require('async/auto');
const {findKey} = require('ln-sync');
const {returnResult} = require('asyncjs-util');

const findPeerMatch = require('./../peers/find_peer_match');
const findTagMatch = require('./../peers/find_tag_match');

/** Find a peer for a rebalance

  {
    active_channels: [{
      capacity: <Channel Token Capacity Number>
      id: <Standard Format Channel Id String>
      local_balance: <Channel Local Balance Tokens Number>
      partner_public_key: <Peer Public Key Hex String>
      pending_payments: [<Pending Payment Object>]
      remote_balance: <Channel Remote Balance Tokens Number>
    }]
    channels: [{
      partner_public_key: <Peer Public Key Hex String>
    }]
    direction: <In or Out Direction String>
    [filters]: [<Peer Filter Formula String>]
    lnd: <Authenticated LND API Object>
    policies: [{
      [base_fee_mtokens]: <Remote Base Fee Charged In Millitokens Number>
      [fee_rate]: <Remote Fees Charged in Millitokens Per Million Number>
      [is_disabled]: <Remote Channel Forwarding Is Disabled Bool>
      public_key: <Remote Public Key Hex String>
    }]
    [query]: <Tag, Public Key, or Alias String>
    tags: [{
      [alias]: <Tag Alias String>
      id: <Tag Id Hex String>
      [nodes]: [<Public Key Hex String>]
    }]
  }

  @returns via cbk or Promise
  {
    [public_key]: <Peer Public Key Hex String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (args.direction !== 'in' && args.direction !== 'out') {
          return cbk([400, 'ExpectedInOrOutDirectionToFindRebalancePeer']);
        }

        return cbk();
      },

      // Find a tag, preserving tag precedence over peer aliases
      tag: ['validate', ({}, cbk) => {
        const filters = args.filters || [];

        if (!args.query && !!filters.length) {
          if (args.direction === 'in') {
            return cbk([400, 'NoPeerMatchesFoundToSatisfyInboundFilter']);
          }

          return cbk([400, 'NoPeerMatchesFoundToSatisfyOutboundFilter']);
        }

        const {failure, is_tag_filtered, match, matches} = findTagMatch({
          filters,
          channels: args.active_channels,
          policies: args.policies,
          query: args.query,
          tags: args.tags,
        });

        if (!!failure) {
          return cbk([400, 'FailedToParseFilter', failure]);
        }

        if (!!matches) {
          if (args.direction === 'in') {
            return cbk([400, 'MultipleTagMatchesFoundForInPeer', {matches}]);
          }

          return cbk([400, 'MultipleTagMatchesFoundForOutPeer', {matches}]);
        }

        if (!!is_tag_filtered && args.direction === 'in') {
          return cbk([400, 'NoPeerMatchesFoundToSatisfyInboundFilter']);
        }

        if (!!is_tag_filtered) {
          return cbk([400, 'NoPeerMatchesFoundToSatisfyOutboundFilter']);
        }

        if (!!match) {
          return cbk(null, {public_key: match});
        }

        return cbk();
      }],

      // Resolve a public key or node alias when the query was not a tag
      key: ['tag', ({tag}, cbk) => {
        if (!!tag) {
          return cbk(null, tag);
        }

        return findKey({
          lnd: args.lnd,
          channels: args.channels,
          query: args.query,
        },
        cbk);
      }],

      // Apply filters to the single explicitly resolved peer
      peer: ['key', 'tag', ({key, tag}, cbk) => {
        const filters = args.filters || [];

        if (!!tag || !filters.length) {
          return cbk(null, key);
        }

        const {failure, match} = findPeerMatch({
          filters,
          channels: args.active_channels,
          nodes: [key.public_key.toLowerCase()],
          policies: args.policies,
        });

        if (!!failure) {
          return cbk([400, 'FailedToParseFilter', failure]);
        }

        if (!match && args.direction === 'in') {
          return cbk([400, 'NoPeerMatchesFoundToSatisfyInboundFilter']);
        }

        if (!match) {
          return cbk([400, 'NoPeerMatchesFoundToSatisfyOutboundFilter']);
        }

        return cbk(null, {public_key: match});
      }],
    },
    returnResult({reject, resolve, of: 'peer'}, cbk));
  });
};
