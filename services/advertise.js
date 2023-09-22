const {createHash} = require('crypto');
const {randomBytes} = require('crypto');

const asyncAuto = require('async/auto');
const asyncFilterLimit = require('async/filterLimit');
const asyncMapSeries = require('async/mapSeries');
const asyncTimeout = require('async/timeout');
const {createInvoice} = require('ln-service');
const {getChannels} = require('ln-service');
const {getNetworkGraph} = require('ln-service');
const {getRouteToDestination} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {payViaRoutes} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {subscribeToProbeForRoute} = require('ln-service');

const {getIgnores} = require('./../routing');
const getNodesGraph = require('./get_nodes_graph');
const {getTags} = require('./../tags');
const {isMatchingFilters} = require('./../display');
const {shuffle} = require('./../arrays');

const {ceil} = Math;
const cltvDelay = 144;
const createSecret = () => randomBytes(32).toString('hex');
const defaultFilter = ['channels_count < 9'];
const defaultMsg = (alias, key) => `Check out my node! ${alias} ${key}`;
const directPeersDistance = 0;
const featureKeysendBit = 55;
const filterLimit = 10;
const flatten = arr => [].concat(...arr);
const hashOf = n => createHash('sha256').update(n).digest().toString('hex');
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const invoiceDescription = n => `👀 ${n}`;
const invoiceExpiration = () => new Date(Date.now() + 1000 * 60 * 60 * 24 * 5);
const invoiceTokens = 1;
const {isArray} = Array;
const keySendValueType = '5482373484';
const maxFeeTokens = 10;
const messageWithReply = (msg, req) => `${msg} (Mark seen: ${req})`;
const minChannelCount = 10;
const mtokPerToken = 1e3;
const pathTimeoutMs = 1000 * 45;
const payTimeoutMs = 1000 * 60;
const probeTimeoutMs = 1000 * 60 * 2;
const routeDistance = route => route.hops.length - 1;
const sendTokens = 10;
const sumOf = arr => arr.reduce((sum, n) => sum + n, Number());
const textMessageType = '34349334';
const uniq = arr => Array.from(new Set(arr));
const utf8AsHex = utf8 => Buffer.from(utf8, 'utf8').toString('hex');

/** Advertise to nodes that accept KeySend

  {
    [avoid]: [<Avoid Advertising To String>]
    filters: [<Node Condition Filter String>]
    fs: {
      getFile: <Read File Contents Function> (path, cbk) => {}
    }
    [is_dry_run]: <Avoid Sending Advertisements Bool>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    [message]: <Message To Send String>
    [max_hops]: <Maxmimum Relaying Nodes Number>
    [min_hops]: <Minimum Relaying Nodes Number>
    tags: [<Tag Name String>]
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isArray(args.avoid)) {
          return cbk([400, 'ExpectedAvoidArrayToAdvertise']);
        }

        if (!isArray(args.filters)) {
          return cbk([400, 'ExpectedArrayOfFiltersToAdvertise']);
        }

        if (!args.fs) {
          return cbk([400, 'ExpectedFileSystemMethodsToAdvertise']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToAdvertise']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedWinstonLoggerToAdvertise']);
        }

        if (!isArray(args.tags)) {
          return cbk([400, 'ExpectedArrayOfTagsToAdvertiseTo']);
        }

        return cbk();
      },

      // Get channels
      getChannels: ['validate', ({}, cbk) => getChannels({lnd: args.lnd}, cbk)],

      // Get the local identity to compose the ad message
      getIdentity: ['validate', ({}, cbk) => {
        return getWalletInfo({lnd: args.lnd}, cbk);
      }],

      // Get tags
      getTags: ['validate', ({}, cbk) => getTags({fs: args.fs}, cbk)],

      // Filter tags
      filterTags: ['getIdentity', 'getTags', ({getIdentity, getTags}, cbk) => {
        // Exit early when there are no tags specified to advertise to
        if (!args.tags.length) {
          return cbk();
        }

        // Look for a referenced tag that doesn't match a present tag
        const unknown = args.tags.find(tagName => {
          return !getTags.tags.find(t => t.alias === tagName);
        });

        // Make sure the tag is present
        if (!!unknown) {
          return cbk([404, 'FailedToFindTagWithSpecifiedName', {unknown}]);
        }

        // Collect all the node identity keys
        const matches = args.tags.map(tagName => {
          const tag = getTags.tags.find(t => t.alias === tagName);

          return tag.nodes.filter(n => n !== getIdentity.public_key);
        });

        // Merge all tagged nodes and remove duplicates
        return cbk(null, uniq(flatten(matches)));
      }],


      // Get ignores
      getIgnores: [
        'getChannels',
        'getIdentity',
        'getTags',
        ({getChannels, getIdentity, getTags}, cbk) =>
      {
        return getIgnores({
          avoid: args.avoid,
          channels: getChannels.channels,
          lnd: args.lnd,
          logger: args.logger,
          public_key: getIdentity.public_key,
          tags: getTags.tags,
        },
        cbk);
      }],

      // Get the graph to use to find candidates to send ads to
      getGraph: ['getChannels', 'filterTags', ({getChannels, filterTags}, cbk) => {
        // Exit early when when advertising to tags.
        if (!!args.tags.length) {
          return getNodesGraph({lnd: args.lnd, nodes: filterTags}, cbk);
        }

        // Exit early when using the entire graph
        if (args.max_hops !== directPeersDistance) {
          args.logger.info({sending_to_all_graph_nodes: true});

          return getNetworkGraph({lnd: args.lnd}, cbk);
        }

        // Collect all ids of channel peers
        const nodes = getChannels.channels.map(n => n.partner_public_key);

        return getNodesGraph({lnd: args.lnd, nodes: uniq(nodes)}, cbk);
      }],

      // Derive the message to send
      message: ['getIdentity', ({getIdentity}, cbk) => {
        const alias = getIdentity.alias || String();
        const identity = getIdentity.public_key;

        const message = args.message || defaultMsg(alias, identity);

        args.logger.info({sending_message: message});

        return cbk(null, message);
      }],

      // Filter out nodes where there is no path
      nodes: [
        'getGraph',
        'getIdentity',
        'getIgnores',
        'message',
        ({getGraph, getIdentity, getIgnores, message}, cbk) =>
      {
        const {shuffled} = shuffle({array: getGraph.nodes});

        // Only consider 3rd party nodes that have known features
        const filteredNodes = shuffled
          .filter(n => n.public_key !== getIdentity.public_key)
          .filter(n => !!n.features.length)
          .filter(n => n.features.map(n => n.bit).includes(featureKeysendBit))
          .map(node => {
            const channels = getGraph.channels.filter(channel => {
              const {policies} = channel;

              return policies.find(n => n.public_key === node.public_key);
            });

            const filters = args.filters.length ? args.filters : defaultFilter;

            const variables = {
              capacity: sumOf(channels.map(n => n.capacity)),
              channels_count: channels.length,
            };

            const isMatching = isMatchingFilters({filters, variables});

            // Exit early when there is a failure with a filter
            if (isMatching.failure) {
              return {failure: isMatching.failure};
            }

            return !!isMatching.is_matching ? {node} : {};
          });

        const failure = filteredNodes.find(n => !!n.failure);

        if (!!filteredNodes.find(n => !!n.failure)) {
          return cbk([400, 'ExpectedValidFiltersForNodes', {failure}]);
        }

        const nodes = filteredNodes.map(n => n.node).filter(n => !!n);

        args.logger.info({potential_nodes: nodes.length});

        return asyncFilterLimit(nodes, filterLimit, (node, cbk) => {
          return getRouteToDestination({
            destination: node.public_key,
            ignore: getIgnores.ignore,
            lnd: args.lnd,
            max_fee: maxFeeTokens,
            messages: [
              {type: keySendValueType, value: createSecret()},
              {type: textMessageType, value: utf8AsHex(message)},
            ],
            tokens: sendTokens,
          },
          (err, res) => {
            // Exit early when there is a problem getting a route
            if (!!err || !res.route) {
              return cbk(null, false);
            }

            const relaysCount = routeDistance(res.route);

            // Exit early when there are too many relaying nodes
            if (args.max_hops !== undefined && relaysCount > args.max_hops) {
              return cbk(null, false);
            }

            // Exit early when there are too few relaying nodes
            if (args.min_hops !== undefined && relaysCount < args.min_hops) {
              return cbk(null, false);
            }

            // There exists a route to the destination within range constraints
            return cbk(null, true);
          });
        },
        cbk);
      }],

      // Send message to nodes
      send: [
        'getIgnores', 
        'message', 
        'nodes', 
        ({getIgnores, message, nodes}, cbk) => {
        const maxSpendPerNode = sendTokens + maxFeeTokens;
        const sent = [];

        args.logger.info({routable_nodes: nodes.length});

        return asyncMapSeries(nodes, (node, cbk) => {
          const paidTokens = ceil(Number(sent.reduce((sum, n) => {
            return sum + BigInt(n.mtokens) + BigInt(n.fee_mtokens);
          },
          BigInt(Number()))) / mtokPerToken);

          // Check that the potential next ad would not go over budget
          if (!!args.budget && paidTokens + maxSpendPerNode > args.budget) {
            return cbk([400, 'AdvertisingBudgetExhausted']);
          }

          const probe = subscribeToProbeForRoute({
            cltv_delay: cltvDelay,
            destination: node.public_key,
            ignore: getIgnores.ignore,
            lnd: args.lnd,
            max_fee: maxFeeTokens,
            messages: [
              {type: keySendValueType, value: createSecret()},
              {type: textMessageType, value: utf8AsHex(message)},
            ],
            path_timeout_ms: pathTimeoutMs,
            probe_timeout_ms: probeTimeoutMs,
            tokens: sendTokens,
          });

          let isFinished = false;

          const timeout = setTimeout(() => {
            isFinished = true;

            probe.removeAllListeners();

            return cbk();
          },
          payTimeoutMs);

          probe.on('end', () => {
            if (isFinished) {
              return;
            }

            clearTimeout(timeout);

            return cbk();
          });

          probe.on('error', () => {});

          probe.on('probe_success', async ({route}) => {
            try {
              // Create a "mark seen" invoice
              const invoice = await createInvoice({
                description: invoiceDescription(node.public_key),
                expires_at: invoiceExpiration(),
                lnd: args.lnd,
                tokens: invoiceTokens,
              });

              // Add a reply payment request to the message
              const finalMessage = messageWithReply(message, invoice.request);

              // Generate the preimage
              const secret = createSecret();

              // Encode the preimage and the advertising message in messages
              route.messages = [
                {type: keySendValueType, value: secret},
                {type: textMessageType, value: utf8AsHex(finalMessage)},
              ];

              // Exit early when this is a dry run
              if (!!args.is_dry_run) {
                return args.logger.info({skipping_due_to_dry_run: node.alias});
              }

              // Send the payment
              const paid = await payViaRoutes({
                id: hashOf(hexAsBuffer(secret)),
                lnd: args.lnd,
                routes: [route],
              });

              sent.push(paid);

              args.logger.info({
                sent_to: `${node.alias || String()} ${node.public_key}`,
                paid: paid.fee + paid.tokens,
                total: {
                  ads: sent.length,
                  paid: ceil(Number(sent.reduce((sum, n) => {
                    return sum + BigInt(n.mtokens) + BigInt(n.fee_mtokens);
                  },
                  BigInt(Number()))) / mtokPerToken),
                },
              });
            } catch (err) {
            }
          });

          return;
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
