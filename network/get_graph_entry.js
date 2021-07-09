const {isIP} = require('net');

const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {decodeChanId} = require('bolt07');
const {formatTokens} = require('ln-sync');
const {getHeight} = require('ln-service');
const {getNetworkGraph} = require('ln-service');
const {getNode} = require('ln-service');
const {getNodeAlias} = require('ln-sync');
const moment = require('moment');
const {returnResult} = require('asyncjs-util');

const {chartAliasForPeer} = require('./../display');
const {formatFeeRate} = require('./../display');
const {getIcons} = require('./../display');
const {emojiIcons} = require('./constants');

const ageMs = time => moment(new Date(Date.now() - time)).fromNow(true);
const blockTime = (current, start) => 1000 * 60 * 10 * (current - start);
const defaultSort = 'age';
const disableTag = isDisabled => isDisabled ? `${emojiIcons.disabled} ` : '';
const displayFee = (n, rate) => n.length ? formatFeeRate({rate}).display : ' ';
const displayTokens = tokens => formatTokens({tokens}).display;
const header = [['Alias','Age','In Fee','Capacity','Out Fee','Public Key']];
const isClear = sockets => !!sockets.find(n => !!isIP(n.socket.split(':')[0]));
const isLarge = features => !!features.find(n => n.type === 'large_channels');
const isOnion = sockets => !!sockets.find(n => /onion/.test(n.socket));
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const {max} = Math;
const {min} = Math;
const sortBy = (a, b) => a > b ? 1 : (a !== b ? -1 : 0);
const sorts = ['capacity', 'age', 'in_fee', 'out_fee'];
const uniq = arr => Array.from(new Set(arr));

/** Get a graph entry

  {
    fs: {
      getFile: <Read File Contents Function> (path, cbk) => {}
    }
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    query: <Graph Query String>
    sort: <Sort By Field String>
  }

  @returns via cbk or Promise
  {
    rows: [[<Table Cell String>]]
  }
*/
module.exports = ({fs, lnd, logger, query, sort}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!fs) {
          return cbk([400, 'ExpectedFsMethodsToGetGraphEntry']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToGetGraphEntry']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedWinstonLoggerToGetGraphEntry']);
        }

        if (!query) {
          return cbk([400, 'ExpectedQueryToGetGraphEntry']);
        }

        if (!!sort && !sorts.includes(sort)) {
          return cbk([400, 'ExpectedKnownSortType', {sorts}]);
        }

        return cbk();
      },

      // Get the current block height to use for age calculations
      getHeight: ['validate', ({}, cbk) => getHeight({lnd}, cbk)],

      // Get the tagged node icons
      getIcons: ['validate', ({}, cbk) => getIcons({fs}, cbk)],

      // Get the overall network graph if we need to find a match to the query
      getGraph: ['validate', ({}, cbk) => {
        // Exit early when the query is a public key
        if (!!isPublicKey(query)) {
          return cbk();
        }

        return getNetworkGraph({lnd}, cbk);
      }],

      // Figure out the public key the query is referring to
      key: ['getGraph', ({getGraph}, cbk) => {
        // Exit early when the query is a public key
        if (!!isPublicKey(query)) {
          return cbk(null, query);
        }

        const matching = getGraph.nodes.filter(node => {
          const alias = node.alias || String();

          const isAliasMatch = alias.toLowerCase().includes(query);
          const isPublicKeyMatch = node.public_key.startsWith(query);

          return isAliasMatch || isPublicKeyMatch;
        });

        const [match, moreMatches] = matching;

        if (!match) {
          return cbk([400, 'FailedToFindMatchingNode']);
        }

        if (!!moreMatches) {
          return cbk([400, 'AmbiguousAliasSpecifiedForNode', {
            matching: matching.map(node => ({
              alias: node.alias,
              public_key: node.public_key,
            })),
          }]);
        }

        return cbk(null, match.public_key);
      }],

      // Get the node details
      getNode: ['key', ({key}, cbk) => getNode({lnd, public_key: key}, cbk)],

      // Derive the set of keys of the peers of the node
      peerKeys: ['getNode', 'key', ({getNode, key}, cbk) => {
        const peerKeys = getNode.channels
          .filter(({policies}) => {
            const enabled = policies.filter(n => n.is_disabled !== true);

            return !!enabled.length;
          })
          .map(n => n.policies.find(n => n.public_key !== key).public_key);

        return cbk(null, uniq(peerKeys));
      }],

      // Get the aliases for the peer nodes
      getAliases: ['peerKeys', ({peerKeys}, cbk) => {
        return asyncMap(peerKeys, (id, cbk) => {
          return getNodeAlias({id, lnd}, cbk);
        },
        cbk);
      }],

      // Log the high-level node details
      nodeDetails: [
        'getIcons',
        'getNode',
        'key',
        'peerKeys',
        ({getIcons, getNode, key, peerKeys}, cbk) =>
      {
        const mainIcons = getIcons.nodes.find(n => n.public_key === key);

        const mainAlias = chartAliasForPeer({
          alias: getNode.alias,
          icons: !!mainIcons ? mainIcons.icons : undefined,
          public_key: key,
        });

        logger.info({
          node: mainAlias.display,
          capacity: displayTokens(getNode.capacity),
          is_accepting_large_channels: isLarge(getNode.features) || undefined,
          is_onion: isOnion(getNode.sockets) || undefined,
          is_clearnet: isClear(getNode.sockets) || undefined,
          is_unconnectable: !getNode.sockets.length || undefined,
          peer_count: peerKeys.length,
        });

        return cbk();
      }],

      // Final table rows of peers
      rows: [
        'getAliases',
        'getHeight',
        'getIcons',
        'getNode',
        'peerKeys',
        ({getAliases, getHeight, getIcons, getNode, peerKeys}, cbk) =>
      {
        const sorting = sort || defaultSort;

        const peers = peerKeys.map(peerKey => {
          const capacity = getNode.channels
            .filter(n => !!n.policies.find(n => n.public_key === peerKey))
            .reduce((sum, {capacity}) => sum + capacity, Number());

          const nodeIcons = getIcons.nodes.find(n => n.public_key === peerKey);

          const chartAlias = chartAliasForPeer({
            alias: getAliases.find(n => n.id === peerKey).alias,
            icons: !!nodeIcons ? nodeIcons.icons : undefined,
            public_key: peerKey,
          });

          const connectHeight = min(...getNode.channels
            .filter(n => !!n.policies.find(n => n.public_key === peerKey))
            .map(({id}) => decodeChanId({channel: id}).block_height));

          const inPolicies = getNode.channels
            .map(n => n.policies.find(n => n.public_key === peerKey))
            .filter(n => !!n && n.fee_rate !== undefined);

          const outPolicies = getNode.channels
            .filter(n => !!n.policies.find(n => n.public_key === peerKey))
            .map(n => n.policies.find(n => n.public_key !== peerKey))
            .filter(n => n.fee_rate !== undefined);

          const inDisabled = inPolicies.filter(n => n.is_disabled === true);
          const inboundFeeRate = max(...inPolicies.map(n => n.fee_rate));
          const outDisabled = outPolicies.filter(n => n.is_disabled === true);
          const outFeeRate = max(...outPolicies.map(n => n.fee_rate));

          const isInDisabled = inDisabled.length === inPolicies.length;
          const isOutDisabled = outDisabled.length === outPolicies.length;

          const sorts = {
            capacity,
            age: connectHeight,
            in_fee: inboundFeeRate,
            out_fee: outFeeRate,
          };

          const row = [
            chartAlias.display,
            ageMs(blockTime(getHeight.current_block_height, connectHeight)),
            disableTag(isInDisabled) + displayFee(inPolicies, inboundFeeRate),
            displayTokens(capacity),
            disableTag(isOutDisabled) + displayFee(outPolicies, outFeeRate),
            peerKey,
          ];

          return {sorts, row};
        });

        peers.sort((a, b) => sortBy(a.sorts[sorting], b.sorts[sorting]));

        const rows = [].concat(header).concat(peers.map(({row}) => row));

        return cbk(null, {rows});
      }],
    },
    returnResult({reject, resolve, of: 'rows'}, cbk));
  });
};
