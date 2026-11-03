const asyncAuto = require('async/auto');
const asyncMapSeries = require('async/mapSeries');
const {findKey} = require('ln-sync');
const {returnResult} = require('asyncjs-util');

const asKey = n => !n.public_key ? undefined : n.public_key.toLowerCase();
const flatten = arr => [].concat(...arr);
const {isArray} = Array;
const uniq = arr => Array.from(new Set(arr));

/** Get out queries with the aliases of out peers resolved to public keys

  Tag queries are kept so that the peers of tags can be found again later

  {
    channels: [{
      partner_public_key: <Peer Public Key Hex String>
    }]
    lnd: <Authenticated LND API Object>
    out: [<Out Through Peer With Public Key, Alias, or Tag String>]
    tags: [{
      [alias]: <Tag Alias String>
      id: <Tag Id Hex String>
      nodes: [<Public Key Hex String>]
    }]
  }

  @returns via cbk or Promise
  {
    public_keys: [<Out Peer Public Key Hex String>]
    queries: [<Out Through Peer Public Key or Tag String>]
  }
*/
module.exports = ({channels, lnd, out, tags}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isArray(channels)) {
          return cbk([400, 'ExpectedArrayOfChannelsToGetOutQueries']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToGetOutQueries']);
        }

        if (!isArray(out)) {
          return cbk([400, 'ExpectedArrayOfOutPeersToGetOutQueries']);
        }

        if (!isArray(tags)) {
          return cbk([400, 'ExpectedArrayOfTagsToGetOutQueries']);
        }

        return cbk();
      },

      // Out queries with the tags that they match on alias or on id
      outQueries: ['validate', ({}, cbk) => {
        return cbk(null, out.map(n => String(n)).map(query => ({
          query,
          tags: tags.filter(tag => {
            const alias = tag.alias || String();

            const isAliasMatch = alias.toLowerCase() === query.toLowerCase();

            return isAliasMatch || tag.id.startsWith(query);
          }),
        })));
      }],

      // Find the public keys of out peers, other than peers of tags
      getKeys: ['outQueries', ({outQueries}, cbk) => {
        return asyncMapSeries(outQueries, (outQuery, cbk) => {
          // Exit early when the query is a tag, its peers are found later
          if (!!outQuery.tags.length) {
            return cbk(null, {});
          }

          return findKey({channels, lnd, query: outQuery.query}, cbk);
        },
        cbk);
      }],

      // Out queries with peer aliases replaced by peer public keys
      queries: ['getKeys', 'outQueries', ({getKeys, outQueries}, cbk) => {
        const keys = getKeys.map(asKey);
        const peers = channels.map(n => n.partner_public_key);
        const tagged = flatten(outQueries.map(n => n.tags));

        // Out peers are the peers that are named and the peers in out tags
        const outPeers = keys.concat(flatten(tagged.map(n => n.nodes)));

        return cbk(null, {
          public_keys: uniq(outPeers.filter(n => peers.includes(n))),
          queries: outQueries.map((n, i) => keys[i] || n.query),
        });
      }],
    },
    returnResult({reject, resolve, of: 'queries'}, cbk));
  });
};
