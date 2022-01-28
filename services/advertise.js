const {createHash} = require('crypto');
const {randomBytes} = require('crypto');

const asyncAuto = require('async/auto');
const asyncFilterLimit = require('async/filterLimit');
const asyncMapSeries = require('async/mapSeries');
const asyncTimeout = require('async/timeout');
const {createInvoice} = require('ln-service');
const {getNetworkGraph} = require('ln-service');
const {getRouteToDestination} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {payViaRoutes} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {subscribeToProbeForRoute} = require('ln-service');

const {isMatchingFilters} = require('./../display');
const {shuffle} = require('./../arrays');

const {ceil} = Math;
const cltvDelay = 144;
const createSecret = () => randomBytes(32).toString('hex');
const defaultFilter = ['channels_count > 9'];
const defaultMsg = (alias, key) => `Check out my node! ${alias} ${key}`;
const filterLimit = 10;
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
const sendTokens = 10;
const sumOf = arr => arr.reduce((sum, n) => sum + n, Number());
const textMessageType = '34349334';
const utf8AsHex = utf8 => Buffer.from(utf8, 'utf8').toString('hex');
/** Advertise to nodes that accept KeySend

  {
    filters: [<Node Condition Filter String>]
    [is_dry_run]: <Avoid Sending Advertisements Bool>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    [message]: <Message To Send String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isArray(args.filters)) {
          return cbk([400, 'ExpectedArrayOfFiltersToAdvertise']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToAdvertise']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedWinstonLoggerToAdvertise']);
        }

        return cbk();
      },

      // Get the network graph
      getGraph: ['validate', ({}, cbk) => {
        args.logger.info({sending_to_all_graph_nodes: true});

        return getNetworkGraph({lnd: args.lnd}, cbk);
      }],

      // Get the local identity
      getIdentity: ['validate', ({}, cbk) => {
        return getWalletInfo({lnd: args.lnd}, cbk);
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
        'message',
        ({getGraph, getIdentity, message}, cbk) =>
      {
        const {shuffled} = shuffle({array: getGraph.nodes});

        // Only consider 3rd party nodes that have known features
        const filteredNodes = shuffled
          .filter(n => n.public_key !== getIdentity.public_key)
          .filter(n => !!n.features.length)
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
            lnd: args.lnd,
            max_fee: maxFeeTokens,
            messages: [
              {type: keySendValueType, value: createSecret()},
              {type: textMessageType, value: utf8AsHex(message)},
            ],
            tokens: sendTokens,
          },
          (err, res) => {
            const isRoutingPossible = !!res && !!res.route;

            return cbk(null, isRoutingPossible);
          });
        },
        cbk);
      }],

      // Send message to nodes
      send: ['message', 'nodes', ({message, nodes}, cbk) => {
        const sent = [];

        args.logger.info({routable_nodes: nodes.length});

        return asyncMapSeries(nodes, (node, cbk) => {
          const probe = subscribeToProbeForRoute({
            cltv_delay: cltvDelay,
            destination: node.public_key,
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

            const total = route.safe_tokens + ceil(Number(sent.reduce((sum, n) => {
              return sum + BigInt(n.mtokens) + BigInt(n.fee_mtokens);
            },
              BigInt(Number()))) / mtokPerToken);

            // Exit when budget is reached
            if(!!args.budget && (total  >= args.budget)) {
              return cbk([400, 'BudgetExceeded']);
            }
            
            // Create a "mark seen" invoice
            try {
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
            }
          );
          return;
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
