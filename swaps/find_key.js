const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {getNode} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const {isArray} = Array;
const isPublicKey = n => /^[0-9A-F]{66}$/i.test(n);
const uniq = arr => Array.from(new Set(arr));

/** Find a public key given a query

  {
    channels: [{
      partner_public_key: <Partner Public Key Hex String>
    }]
    lnd: <Authenticated LND API Object>
    [query]: <Query String>
  }

  @returns via cbk or Promise
  {
    [public_key]: <Public Key Hex String>
  }
*/
module.exports = ({channels, lnd, query}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isArray(channels)) {
          return cbk([400, 'ExpectedArrayOfChannelsToFindPublicKey']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToFindPublicKey']);
        }

        return cbk();
      },

      // Check arguments
      publicKey: ['validate', ({}, cbk) => {
        // Exit early when there is no public key
        if (!query) {
          return cbk();
        }

        // Exit early when query is an alias search
        if (!isPublicKey(query)) {
          return cbk();
        }

        return cbk(null, query);
      }],

      // Get nodes
      getNodes: ['publicKey', ({publicKey}, cbk) => {
        // Exit early when there is no query or the query is a public key
        if (!query || !!publicKey) {
          return cbk();
        }

        const keys = uniq(channels.map(n => n.partner_public_key));

        return asyncMap(keys, (key, cbk) => {
          return getNode({
            lnd,
            is_omitting_channels: true,
            public_key: key,
          },
          (err, node) => {
            // Suppress errors on matching lookup
            if (!!err) {
              return cbk();
            }

            // Exit early when the alias doesn't match the query
            if (!node.alias.toLowerCase().includes(query.toLowerCase())) {
              return cbk();
            }

            return cbk(null, {alias: node.alias, public_key: key});
          });
        },
        cbk);
      }],

      // Found public key
      key: ['getNodes', 'publicKey', ({getNodes, publicKey}, cbk) => {
        // Exit early when this is not a nodes search
        if (!getNodes) {
          return cbk(null, {public_key: publicKey});
        }

        const matching = getNodes.filter(n => !!n);

        if (!matching.length) {
          return cbk([400, 'FailedToFindAliasMatch', {not_found: query}]);
        }

        const [match, secondMatch] = matching;

        if (!!secondMatch) {
          return cbk([400, 'AmbiguousAliasSpecified', {matching}]);
        }

        return cbk(null, {public_key: match.public_key});
      }],
    },
    returnResult({reject, resolve, of: 'key'}, cbk));
  });
};
