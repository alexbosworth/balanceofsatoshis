const {isIP} = require('net');

const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {decodeChanId} = require('bolt07');
const {findKey} = require('ln-sync');
const {formatTokens} = require('ln-sync');
const {getHeight} = require('ln-service');
const {getNetworkGraph} = require('ln-service');
const {getNode} = require('ln-service');
const {getNodeAlias} = require('ln-sync');
const {getRouteToDestination} = require('ln-service');
const moment = require('moment');
const {returnResult} = require('asyncjs-util');

const {chartAliasForPeer} = require('./../display');
const {emojiIcons} = require('./constants');
const {formatFeeRate} = require('./../display');
const {getIcons} = require('./../display');
const {isMatchingFilters} = require('./../display');

const ageMs = time => moment(new Date(Date.now() - time)).fromNow(true);
const blockTime = (current, start) => 1000 * 60 * 10 * (current - start);
const defaultSort = 'age';
const disableTag = isDisabled => isDisabled ? `${emojiIcons.disabled} ` : '';
const displayDiscount = fee => !!fee && isFinite(fee) ? ` ←${-fee}` : '';
const displayFee = (n, rate) => n.length ? formatFeeRate({rate}).display : ' ';
const displayTokens = tokens => formatTokens({tokens}).display;
const distanceTokens = 100;
const hasDistanceFilter = filters => /hops/gim.test(filters.join(' '));
const header = [['Alias','Age','In Fee','Capacity','Out Fee','Public Key']];
const hopsTitle = 'Hops';
const {isArray} = Array;
const isClear = sockets => !!sockets.find(n => !!isIP(n.socket.split(':')[0]));
const isLarge = features => !!features.find(n => n.type === 'large_channels');
const isOnion = sockets => !!sockets.find(n => /onion/.test(n.socket));
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const join = arr => arr.join('');
const {max} = Math;
const {min} = Math;
const sortBy = (a, b) => a > b ? 1 : (a !== b ? -1 : 0);
const sorts = ['capacity', 'age', 'in_fee', 'out_fee'];
const uniq = arr => Array.from(new Set(arr));

/** Get a graph entry

  {
    filters: [<Filter Expression String>]
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
module.exports = ({filters, fs, lnd, logger, query, sort}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isArray(filters)) {
          return cbk([400, 'ExpectedArrayOfFiltersToGetGraphEntry']);
        }

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

      // Determine the public key to use
      getKey: ['validate', ({}, cbk) => findKey({lnd, query}, cbk)],

      // Pull out the public key from getKey result
      key: ['getKey', ({getKey}, cbk) => cbk(null, getKey.public_key)],

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
          id: key,
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

      // Get distances
      getDistances: ['peerKeys', ({peerKeys}, cbk) => {
        // Exit early when there is no distance filter
        if (!hasDistanceFilter(filters)) {
          return cbk(null, peerKeys.map(destination => ({destination})));
        }

        return asyncMap(peerKeys, (destination, cbk) => {
          return getRouteToDestination({
            destination,
            lnd,
            is_ignoring_past_failure: true,
            tokens: distanceTokens,
          },
          (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            if (!res.route) {
              return cbk(null, {destination, hops: Infinity});
            }

            return cbk(null, {destination, hops: --res.route.hops.length});
          });
        },
        cbk);
      }],

      // Final set of peers
      peers: [
        'getDistances',
        'getHeight',
        'getIcons',
        'getNode',
        'peerKeys',
        ({getDistances, getHeight, getIcons, getNode, peerKeys}, cbk) =>
      {
        const sorting = sort || defaultSort;

        const peers = peerKeys.map(peerKey => {
          const {hops} = getDistances.find(n => n.destination === peerKey);

          const capacity = getNode.channels
            .filter(n => !!n.policies.find(n => n.public_key === peerKey))
            .reduce((sum, {capacity}) => sum + capacity, Number());

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

          const backFee = min(...inPolicies.map(n => n.inbound_rate_discount));
          const inDisabled = inPolicies.filter(n => n.is_disabled === true);
          const inboundFeeRate = max(...inPolicies.map(n => n.fee_rate));
          const outDisabled = outPolicies.filter(n => n.is_disabled === true);
          const outFeeRate = max(...outPolicies.map(n => n.fee_rate));
          const rebate = min(...outPolicies.map(n => n.inbound_rate_discount));

          const isInDisabled = inDisabled.length === inPolicies.length;
          const isOutDisabled = outDisabled.length === outPolicies.length;

          const sorts = {
            capacity,
            age: connectHeight,
            in_fee: inboundFeeRate,
            out_fee: outFeeRate,
          };

          // Check if the peer matches filters
          const matching = isMatchingFilters({
            filters,
            variables: {
              capacity,
              hops,
              age: getHeight.current_block_height - connectHeight,
              height: connectHeight,
              in_fee_rate: inboundFeeRate,
              out_fee_rate: outFeeRate,
            },
          });

          // Exit early when there is a filter error
          if (!!matching.failure) {
            return matching.failure;
          }

          // Exit early when the peer is not matching provided filters
          if (!matching.is_matching) {
            return;
          }

          const displayInPolicy = [
            disableTag(isInDisabled),
            displayFee(inPolicies, inboundFeeRate),
            displayDiscount(backFee),
          ];

          const displayOutPolicy = [
            disableTag(isOutDisabled),
            displayFee(outPolicies, outFeeRate),
            displayDiscount(rebate),
          ];

          const row = [
            ageMs(blockTime(getHeight.current_block_height, connectHeight)),
            join(displayInPolicy),
            displayTokens(capacity),
            join(displayOutPolicy),
            peerKey,
          ];

          if (!!hasDistanceFilter(filters)) {
            row.unshift(hops);
          }

          return {sorts, row};
        })
        .filter(n => !!n);

        // Exit early when there was an error in one of the filters
        if (!!peers.find(n => !!n.error)) {
          return cbk([500, 'FailedToParseFilter', peers.find(n => n.error)]);
        }

        peers.sort((a, b) => sortBy(a.sorts[sorting], b.sorts[sorting]));

        return cbk(null, peers.map(n => n.row));
      }],

      // Get rows with peer aliases
      getRowsWithAliases: ['getIcons', 'peers', ({getIcons, peers}, cbk) => {
        return asyncMap(peers, (peer, cbk) => {
          // The public key is the final column
          const [id] = peer.slice().reverse();

          const nodeIcons = getIcons.nodes.find(n => n.public_key === id);

          return getNodeAlias({id, lnd}, (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            const chartAlias = chartAliasForPeer({
              alias: res.alias,
              icons: !!nodeIcons ? nodeIcons.icons : undefined,
              public_key: id,
            });

            return cbk(null, [chartAlias.display].concat(peer));
          });
        },
        cbk);
      }],

      // Final set of rows
      rows: ['getRowsWithAliases', ({getRowsWithAliases}, cbk) => {
        const [titles] = header;

        const headers = titles.slice();

        if (!!hasDistanceFilter(filters)) {
          const first = headers.shift();

          headers.unshift(hopsTitle);
          headers.unshift(first);
        }

        const rows = [].concat([headers]).concat(getRowsWithAliases);

        return cbk(null, {rows});
      }],
    },
    returnResult({reject, resolve, of: 'rows'}, cbk));
  });
};
