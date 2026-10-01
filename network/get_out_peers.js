const asyncAuto = require('async/auto');
const asyncMapSeries = require('async/mapSeries');
const {findKey} = require('ln-sync');
const {getChannels} = require('ln-service');
const {getIdentity} = require('ln-service');
const {getNode} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const findPeerMatch = require('./../peers/find_peer_match');
const {getTags} = require('./../tags');

const flatten = arr => [].concat(...arr);
const {isArray} = Array;
const isFeeFilter = n => /\binbound_(base_fee|fee_rate)\b/i.test(n);
const uniq = arr => Array.from(new Set(arr));

/** Get the peers to route out through, expanding tags and applying filters

  A tag query expands to all of the tagged peers that satisfy the filters

  {
    [filters]: [<Outbound Peer Filter Formula String>]
    [fs]: {
      getFile: <Read File Contents Function> (path, cbk) => {}
    }
    lnd: <Authenticated LND API Object>
    out: [<Out Through Peer Public Key, Alias, or Tag String>]
  }

  @returns via cbk or Promise
  {
    public_keys: [<Out Through Peer Public Key Hex String>]
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!!args.filters && !isArray(args.filters)) {
          return cbk([400, 'ExpectedArrayOfOutFiltersToGetOutPeers']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToGetOutPeers']);
        }

        if (!isArray(args.out)) {
          return cbk([400, 'ExpectedArrayOfOutQueriesToGetOutPeers']);
        }

        if (!!args.out.filter(n => !n).length) {
          return cbk([400, 'ExpectedNonEmptyOutQueriesToGetOutPeers']);
        }

        // Filters narrow down out peers so there must be out peers to filter
        if (!args.out.length && !!args.filters && !!args.filters.length) {
          return cbk([400, 'NoPeerMatchesFoundToSatisfyOutboundFilter']);
        }

        return cbk();
      },

      // Get channels to find peers
      getChannels: ['validate', ({}, cbk) => {
        // Exit early when there are no out peers
        if (!args.out.length) {
          return cbk();
        }

        return getChannels({lnd: args.lnd}, cbk);
      }],

      // Get the identity key to find the remote policies of channels
      getIdentity: ['validate', ({}, cbk) => {
        // Exit early when there are no filters that use fee variables
        if (!(args.filters || []).some(isFeeFilter)) {
          return cbk();
        }

        return getIdentity({lnd: args.lnd}, cbk);
      }],

      // Get the set of tags
      getTags: ['validate', ({}, cbk) => {
        // Exit early when there are no out peers or no way to read tags
        if (!args.fs || !args.out.length) {
          return cbk(null, {tags: []});
        }

        return getTags({fs: args.fs}, cbk);
      }],

      // Get the remote policies of channels for fee filter variables
      getPolicies: ['getIdentity', ({getIdentity}, cbk) => {
        // Exit early when there are no filters that use fee variables
        if (!getIdentity) {
          return cbk(null, []);
        }

        const id = getIdentity.public_key;

        return getNode({lnd: args.lnd, public_key: id}, (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          const policies = res.channels
            .map(channel => channel.policies.find(n => n.public_key !== id))
            .filter(n => !!n)
            .map(policy => ({
              base_fee_mtokens: policy.base_fee_mtokens,
              fee_rate: policy.fee_rate,
              public_key: policy.public_key,
            }));

          return cbk(null, policies);
        });
      }],

      // Find the peers for each out query
      getPeers: [
        'getChannels',
        'getPolicies',
        'getTags',
        ({getChannels, getPolicies, getTags}, cbk) =>
      {
        // Exit early when there are no out peers
        if (!args.out.length) {
          return cbk(null, []);
        }

        const active = getChannels.channels.filter(n => !!n.is_active);
        const filters = args.filters || [];

        const peerKeys = uniq(active.map(n => n.partner_public_key));

        // Check if a peer satisfies the filters
        const isMatch = key => findPeerMatch({
          filters,
          channels: active,
          nodes: [key],
          policies: getPolicies,
        });

        return asyncMapSeries(args.out.map(n => String(n)), (query, cbk) => {
          // Find tags that match on id or on alias
          const tagMatches = getTags.tags.filter(tag => {
            const alias = tag.alias || String();

            const isAliasMatch = alias.toLowerCase() === query.toLowerCase();
            const isIdMatch = tag.id.startsWith(query);

            return isAliasMatch || isIdMatch;
          });

          // Limit tag matches to tags with relevant peers
          const matches = tagMatches.filter(tag => {
            return (tag.nodes || []).some(n => peerKeys.includes(n));
          });

          const [tag, ...otherTags] = matches;

          if (!!otherTags.length) {
            return cbk([400, 'MultipleTagMatchesFoundForOutPeer', {matches}]);
          }

          // A recognized tag must not fall through to an alias search
          if (!tag && !!tagMatches.length) {
            return cbk([400, 'NoActivePeersFoundForOutTag', {query}]);
          }

          // Exit early when the query is a tag, expanding to its peers
          if (!!tag) {
            const results = uniq(tag.nodes)
              .filter(n => peerKeys.includes(n))
              .map(key => isMatch(key));

            const {failure} = results.find(n => !!n.failure) || {};

            if (!!failure) {
              return cbk([400, 'FailedToParseFilter', failure]);
            }

            const keys = results.map(n => n.match).filter(n => !!n);

            if (!keys.length) {
              return cbk([400, 'NoPeerMatchesFoundToSatisfyOutboundFilter']);
            }

            return cbk(null, keys);
          }

          // The query is not a tag so look for a public key or alias match
          return findKey({
            query,
            channels: getChannels.channels,
            lnd: args.lnd,
          },
          (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            const key = res.public_key.toLowerCase();

            // Exit early when there are no filters to apply
            if (!filters.length) {
              return cbk(null, [key]);
            }

            const {failure, match} = isMatch(key);

            if (!!failure) {
              return cbk([400, 'FailedToParseFilter', failure]);
            }

            if (!match) {
              return cbk([400, 'NoPeerMatchesFoundToSatisfyOutboundFilter']);
            }

            return cbk(null, [match]);
          });
        },
        cbk);
      }],

      // Final set of out peers
      peers: ['getPeers', ({getPeers}, cbk) => {
        return cbk(null, {public_keys: uniq(flatten(getPeers))});
      }],
    },
    returnResult({reject, resolve, of: 'peers'}, cbk));
  });
};
