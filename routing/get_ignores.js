const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {findKey} = require('ln-sync');
const {getChannel} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const flatten = arr => [].concat(...arr);
const {isArray} = Array;
const isChannel = n => /^\d*x\d*x\d*$/.test(n);
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const uniq = arr => Array.from(new Set(arr));

/** Get ignores for avoids

  {
    avoid: [<Avoid Forwarding Through Node With Public Key Hex String>]
    channels: [<Channel Object>]
    [in_through]: <In Through Public Key Hex String>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    [out_through]: <Out Through Public Key Hex String>
    public_key: <Identity Public Key Hex String>
    tags: [{
      alias: <Tag Alias String>
      id: <Tag Id String>
      [is_avoided]: <Tag Nodes Are Avoided For Routing Bool>
      nodes: [<Node Public Key Hex String>]
    }]
  }

  @returns via cbk or Promise
  {
    ignore: [{
      from_public_key: <Avoid Node With Public Key Hex String>
      [to_public_key]: <Avoid Routing To Node With Public Key Hex String>
    }]
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isArray(args.avoid)) {
          return cbk([400, 'ExpectedArrayOfAvoidIdsToGetIgnores']);
        }

        if (!isArray(args.channels)) {
          return cbk([400, 'ExpectedArrayOfChannelsToGetIgnores']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToGetIgnores']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToGetIgnores']);
        }

        if (!args.public_key) {
          return cbk([400, 'ExpectedPublicKeyToGetIgnores']);
        }

        if (!isArray(args.tags)) {
          return cbk([400, 'ExpectedArrayOfTagsToGetIgnores']);
        }

        return cbk();
      },

      // Set of avoids
      avoids: ['validate', ({}, cbk) => {
        // Find global avoids in tags
        const tagAvoids = flatten(args.tags
          .filter(n => !!n.is_avoided)
          .map(({nodes}) => nodes));

        // Mix global avoids with explicit avoids
        const avoids = [].concat(args.avoid).concat(tagAvoids)
          .filter(n => n !== args.public_key)
          .map(n => n.toLowerCase());

        // Never avoid the source key
        return cbk(null, uniq(avoids));
      }],

      // Avoids sorted by type
      sortedAvoids: ['avoids', ({avoids}, cbk) => {
        const withKeys = avoids.map(id => {
          // Exit early when the id is a public key
          if (isPublicKey(id)) {
            return {node: {from_public_key: id}};
          }

          // Exit early when the id is a channel
          if (isChannel(id)) {
            return {channel: id};
          }

          const tagByAlias = args.tags.find(n => n.alias === id);
          const tagById = args.tags.find(n => n.id === id);

          // Exit early when the id matches a tag alias or id
          if (!!tagByAlias || !!tagById) {
            const {nodes} = tagByAlias || tagById;

            args.logger.info({avoiding_tag: `${id}: ${nodes.length} nodes`});

            return nodes.map(n => ({node: {from_public_key: n}}));
          }

          return {query: id};
        });

        return cbk(null, flatten(withKeys));
      }],

      // Get referenced channels
      getChannelIgnores: ['sortedAvoids', ({sortedAvoids}, cbk) => {
        const ids = sortedAvoids.map(n => n.channel).filter(n => !!n);

        return asyncMap(ids, (id, cbk) => {
          return getChannel({id, lnd: args.lnd}, (err, res) => {
            if (!!err) {
              return cbk([404, 'FailedToFindChannelToAvoid', {err, id}]);
            }

            const [node1, node2] = res.policies.map(n => n.public_key);

            const ignore = [
              {channel: id, from_public_key: node1, to_public_key: node2},
              {channel: id, from_public_key: node2, to_public_key: node1},
            ];

            return cbk(null, ignore);
          });
        },
        cbk);
      }],

      // Resolve referenced queries
      getQueryIgnores: ['sortedAvoids', ({sortedAvoids}, cbk) => {
        const queries = sortedAvoids.map(n => n.query).filter(n => !!n);

        return asyncMap(queries, (query, cbk) => {
          return findKey({
            query,
            lnd: args.lnd,
            channels: args.channels,
          },
          (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            return cbk(null, {from_public_key: res.public_key});
          });
        },
        cbk);
      }],

      // Combine ignores together
      combinedIgnores: [
        'getChannelIgnores',
        'getQueryIgnores',
        'sortedAvoids',
        ({getChannelIgnores, getQueryIgnores, sortedAvoids}, cbk) =>
      {
        const chanIgnores = flatten(getChannelIgnores);
        const nodeIgnores = sortedAvoids.map(n => n.node).filter(n => !!n);

        const ignore = [chanIgnores, getQueryIgnores, nodeIgnores];

        const allIgnores = flatten(ignore).filter(avoid => {
          const isFromInThrough = avoid.from_public_key === args.in_through;
          const isFromSelf = avoid.from_public_key === args.public_key;
          const isToOutThrough = avoid.to_public_key === args.out_through;
          const isToSelf = avoid.to_public_key === args.public_key;

          if (isFromSelf && isToOutThrough) {
            return false;
          }

          if (isToSelf && isFromInThrough) {
            return false;
          }

          return true;
        });

        return cbk(null, {ignore: allIgnores});
      }],
    },
    returnResult({reject, resolve, of: 'combinedIgnores'}, cbk));
  });
};
