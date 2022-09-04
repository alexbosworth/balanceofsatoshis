const {randomBytes} = require('crypto');

const {acceptsChannelOpen} = require('ln-sync');
const {addPeer} = require('ln-service');
const {address} = require('bitcoinjs-lib');
const {askForFeeRate} = require('ln-sync');
const asyncAuto = require('async/auto');
const asyncEach = require('async/each');
const asyncEachSeries = require('async/eachSeries');
const asyncDetectSeries = require('async/detectSeries');
const asyncMap = require('async/map');
const asyncMapSeries = require('async/mapSeries');
const asyncReflect = require('async/reflect');
const asyncRetry = require('async/retry');
const {broadcastChainTransaction} = require('ln-service');
const {cancelPendingChannel} = require('ln-service');
const {fundPendingChannels} = require('ln-service');
const {getFundedTransaction} = require('ln-sync');
const {getChannels} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {getNode} = require('ln-service');
const {getPeers} = require('ln-service');
const {getPendingChannels} = require('ln-service');
const {getPsbtFromTransaction} = require('goldengate');
const {getWalletVersion} = require('ln-service');
const {openChannels} = require('ln-service');
const {maintainUtxoLocks} = require('ln-sync');
const moment = require('moment');
const {returnResult} = require('asyncjs-util');
const {Transaction} = require('bitcoinjs-lib');
const {unlockUtxo} = require('ln-service');

const adjustFees = require('./../routing/adjust_fees');
const {authenticatedLnd} = require('./../lnd');
const channelsFromArguments = require('./channels_from_arguments');
const {getAddressUtxo} = require('./../chain');
const {parseAmount} = require('./../display');

const bech32AsData = bech32 => address.fromBech32(bech32).data;
const detectNetworks = ['btc', 'btctestnet'];
const flatten = arr => [].concat(...arr);
const format = 'p2wpkh';
const {fromHex} = Transaction;
const interval = 1000;
const {isArray} = Array;
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const knownTypes = ['private', 'public'];
const knownFundingTypes = ['false', 'true'];
const lineBreak = '\n';
const noInternalFundingVersions = ['0.11.0-beta', '0.11.1-beta'];
const notFound = -1;
const peerAddedDelayMs = 1000 * 5;
const pendingCheckTimes = 60 * 10;
const per = (a, b) => (a / b).toFixed(2);
const relockIntervalMs = 1000 * 20;
const times = 10;
const tokAsBigUnit = tokens => (tokens / 1e8).toFixed(8);
const uniq = arr => Array.from(new Set(arr));
const utxoPollingIntervalMs = 1000 * 30;
const utxoPollingTimes = 20;

/** Open channels with peers

  {
    ask: <Ask For Input Function>
    capacities: [<New Channel Capacity Tokens String>]
    cooperative_close_addresses: [<Cooperative Close Address>]
    fs: {
      getFile: <Read File Contents Function> (path, cbk) => {}
    }
    funding_types: [<Funding Type String>]
    gives: [<New Channel Give Tokens Number>]
    [is_external]: <Use External Funds to Open Channels Bool>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    opening_nodes: [<Open New Channel With Saved Node Name String>]
    public_keys: [<Public Key Hex String>]
    request: <Request Function>
    set_fee_rates: [<Fee Rate Number>]
    types: [<Channel Type String>]
  }

  @returns via cbk or Promise
  {
    transaction_id: <Open Channels Transaction Id Hex String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.ask) {
          return cbk([400, 'ExpectedAskMethodToOpenChannels']);
        }

        if (!isArray(args.capacities)) {
          return cbk([400, 'ExpectedChannelCapacitiesToOpenChannels']);
        }

        if (!isArray(args.cooperative_close_addresses)) {
          return cbk([400, 'ExpectedCooperativeCloseAddressesArray']);
        }

        if (!isArray(args.funding_types)) {
          return cbk([400, 'ExpectedArrayOfFundingTypesToOpenChannels']);
        }

        if (!isArray(args.gives)) {
          return cbk([400, 'ExpectedArrayOfGivesToOpenChannels']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToInitiateOpenChannelRequests']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToInitiateOpenChannelRequests']);
        }

        if (!isArray(args.opening_nodes)) {
          return cbk([400, 'ExpectedOpeningNodesArrayToInitiateOpenChannels']);
        }

        if (!isArray(args.public_keys)) {
          return cbk([400, 'ExpectedPublicKeysToOpenChannels']);
        }

        if (!!args.public_keys.filter(n => !isPublicKey(n)).length) {
          return cbk([400, 'NodesToOpenWithMustBeSpecifiedWithPublicKeyOnly']);
        }

        const closeAddrCount = args.cooperative_close_addresses.length;
        const hasCapacities = !!args.capacities.length;
        const hasGives = !!args.gives.length;
        const hasFeeRates = !!args.set_fee_rates.length;
        const hasFundingTypes = !!args.funding_types.length;
        const hasNodes = !!args.opening_nodes.length;
        const publicKeysLength = args.public_keys.length;

        if (!!hasCapacities && publicKeysLength !== args.capacities.length) {
          return cbk([400, 'CapacitiesMustBeSpecifiedForEveryPublicKey']);
        }

        if (!!closeAddrCount && publicKeysLength !== closeAddrCount) {
          return cbk([400, 'MustSetCoopClosingAddressForEveryPublicKey']);
        }

        if (!!hasGives && publicKeysLength !== args.gives.length) {
          return cbk([400, 'GivesMustBeSpecifiedForEveryPublicKey']);
        }

        if (!!hasFeeRates && publicKeysLength !== args.set_fee_rates.length) {
          return cbk([400, 'MustSetFeeRateForEveryPublicKey']);
        }

        if (!!hasFundingTypes && publicKeysLength !== args.funding_types.length) {
          return cbk([400, 'MustSetTrustedForEveryPublicKey']);
        }

        if (!!hasNodes && publicKeysLength !== args.opening_nodes.length) {
          return cbk([400, 'MustSetOpeningNodeForEveryPublicKey']);
        }

        if (!!args.is_external && !!args.internal_fund_fee_rate) {
          return cbk([400, 'CannotUseBothInternalAndExternalFundsForOpen']);
        }

        if (!args.request) {
          return cbk([400, 'ExpectedRequestFunctionToOpenChannels']);
        }

        if (!isArray(args.types)) {
          return cbk([400, 'ExpectedArrayOfTypesToOpenChannels']);
        }

        if (args.funding_types.findIndex(n => !knownFundingTypes.includes(n)) !== notFound) {
          return cbk([400, 'UnknownFundingType']);
        }

        if (args.types.findIndex(n => !knownTypes.includes(n)) !== notFound) {
          return cbk([400, 'UnknownChannelType']);
        }

        if (!!args.types.length && args.types.length !== publicKeysLength) {
          return cbk([400, 'ChannelTypesMustBeSpecifiedForEveryPublicKey']);
        }

        return cbk();
      },

      // Parse capacities
      capacities: ['validate', ({}, cbk) => {
        const capacities = args.capacities.map(amount => {
          try {
            return parseAmount({amount}).tokens;
          } catch (err) {
            return cbk([400, err.message]);
          }
        });

        return cbk(null, capacities);
      }],

      // Get the wallet version to make sure the node supports internal funding
      getWalletVersion: ['validate', ({}, cbk) => {
        return getWalletVersion({lnd: args.lnd}, cbk);
      }],

      // Deny known unsupported versions
      checkWalletVersion: ['getWalletVersion', ({getWalletVersion}, cbk) => {
        // Exit early when funding type is not set
        if (!args.funding_types.length) {
          return cbk();
        }

        switch (getWalletVersion.version) {
        case '0.11.0-beta':
        case '0.11.1-beta':
        case '0.12.0-beta':
        case '0.12.1-beta':
        case '0.13.0-beta':
        case '0.13.1-beta':
        case '0.13.2-beta':
        case '0.13.3-beta':
        case '0.13.4-beta':
        case '0.14.0-beta':
        case '0.14.1-beta':
        case '0.14.2-beta':
        case '0.14.3-beta':
        case '0.15.0-beta':
          return cbk([501, 'TrustedFundingUnsupportedOnThisLndVersion']);

        default:
          return cbk();
        }
      }],

      // Get LNDs associated with nodes specified for opening
      getLnds: ['validate', 'checkWalletVersion', ({}, cbk) => {
        // Exit early when there are no opening nodes specified
        if (!args.opening_nodes.length) {
          return cbk(null, [{lnd: args.lnd}]);
        }

        return asyncMapSeries(uniq(args.opening_nodes), (node, cbk) => {
          return authenticatedLnd({node, logger: args.logger}, (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            return cbk(null, {node, lnd: res.lnd});
          });
        },
        cbk);
      }],

      // Get the default network name
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd: args.lnd}, cbk)],

      // Get sockets in case we need to connect
      getNodes: ['validate', 'checkWalletVersion', ({}, cbk) => {
        return asyncMap(uniq(args.public_keys), (key, cbk) => {
          return getNode({lnd: args.lnd, public_key: key}, (err, res) => {
            // Ignore errors when a node is unknown in the graph
            if (!!err) {
              return cbk(null, {public_key: key, sockets: []});
            }

            const peers = res.channels.map(({policies}) => {
              return policies.find(n => n.public_key !== key).public_key;
            });

            const isBig = res.features.find(n => n.type === 'large_channels');

            return cbk(null, {
              alias: res.alias,
              channels_count: res.channels.length,
              is_accepting_large_channels: !!isBig || undefined,
              peers_count: uniq(peers).length,
              public_key: key,
              sockets: res.sockets,
            });
          });
        },
        cbk);
      }],

      // Get the networks of the opening nodes
      getOpeningNetworks: ['getLnds', ({getLnds}, cbk) => {
        if (!getLnds) {
          return cbk();
        }

        return asyncMap(getLnds, ({lnd}, cbk) => getNetwork({lnd}, cbk), cbk);
      }],

      // Get the opening parameters to use to open the new channels
      opens: ['capacities', ({capacities}, cbk) => {
        const {opens} = channelsFromArguments({
          capacities,
          addresses: args.cooperative_close_addresses,
          funding_types: args.funding_types,
          gives: args.gives,
          nodes: args.public_keys,
          rates: args.set_fee_rates,
          saved: args.opening_nodes,
          types: args.types,
        });

        return cbk(null, opens);
      }],

      // Check if all networks are the same
      checkNetworks: [
        'getNetwork',
        'getOpeningNetworks',
        ({getNetwork, getOpeningNetworks}, cbk) =>
      {
        // Exit early when there are no networks to check
        if (!getOpeningNetworks) {
          return cbk();
        }

        if (!!getOpeningNetworks.find(n => n.network !== getNetwork.network)) {
          return cbk([400, 'AllOpeningNodesMustBeOnSameChain']);
        }

        return cbk();
      }],

      // Get connected peers to see if we are already connected
      getPeers: ['getLnds', ({getLnds}, cbk) => {
        // Exit early when there are no opening nodes
        if (!args.opening_nodes.length) {
          return getPeers({lnd: args.lnd}, (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            return cbk(null, [{peers: res.peers}]);
          });
        }

        return asyncMap(args.opening_nodes, (node, cbk) => {
          const {lnd} = getLnds.find(n => n.node === node);

          return getPeers({lnd}, (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            return cbk(null, {node, peers: res.peers});
          });
        },
        cbk);
      }],

      // Connect up to the peers
      connect: [
        'getLnds',
        'getNodes',
        'getPeers',
        'opens',
        ({getLnds, getNodes, getPeers, opens}, cbk) =>
      {
        // Collect some details about nodes being connected to
        const nodes = getNodes.filter(n => !!n.channels_count).map(node => {
          return {
            node: `${node.alias || node.public_key}`,
            channels_per_peer: `${per(node.channels_count, node.peers_count)}`,
            is_accepting_large_channels: node.is_accepting_large_channels,
          };
        });

        args.logger.info(nodes);

        // Connect up as peers
        return asyncEach(opens, ({node, channels}, cbk) => {
          // Summarize who is being opened to
          const openingTo = getNodes
            .filter(remote => {
              return !!channels.find(channel => {
                return channel.partner_public_key === remote.public_key;
              });
            })
            .map(remote => {
              const {capacity} = channels.find(channel => {
                return channel.partner_public_key === remote.public_key;
              });

              const remoteNamed = remote.alias || remote.public_key;

              return `${remoteNamed}: ${tokAsBigUnit(capacity)}`;
            });

          args.logger.info({node, opening_to: openingTo});

          const connectToKeys = channels.map(n => n.partner_public_key);
          const {lnd} = getLnds.find(n => n.node === node);
          const {peers} = getPeers.find(n => n.node === node);

          return asyncEach(connectToKeys, (key, cbk) => {
            // Exit early when the peer is already connected
            if (peers.map(n => n.public_key).includes(key)) {
              return cbk();
            }

            const to = getNodes.find(n => n.public_key === key);

            if (!to.sockets.length) {
              return cbk([503, 'NoAddressFoundToConnectToNode', {to}]);
            }

            args.logger.info({
              connecting_to: {alias: to.alias, public_key: to.public_key},
              from: node,
            });

            return asyncRetry({times}, cbk => {
              return asyncDetectSeries(to.sockets, ({socket}, cbk) => {
                return addPeer({lnd, socket, public_key: key}, err => {
                  return cbk(null, !err);
                });
              },
              (err, res) => {
                if (!!err) {
                  return cbk(err);
                }

                if (!res) {
                  return cbk([503, 'FailedToConnectToPeer', ({peer: key})]);
                }

                return setTimeout(() => cbk(null, true), peerAddedDelayMs);
              });
            },
            cbk);
          },
          cbk);
        },
        cbk);
      }],

      // Check all nodes that they will allow an inbound channel
      checkAcceptance: [
        'connect',
        'getLnds',
        'opens',
        ({connect, getLnds, opens}, cbk) =>
      {
        // Flatten out the opens so that they can be tried serially
        const tests = opens.map(({channels, node}) => {
          return channels.map(channel => ({
            capacity: channel.capacity,
            cooperative_close_address: channel.cooperative_close_address,
            give_tokens: channel.give_tokens,
            is_private: channel.is_private,
            is_trusted_funding: channel.is_trusted_funding,
            lnd: getLnds.find(n => n.node === node).lnd,
            partner_public_key: channel.partner_public_key,
          }));
        });

        return asyncEachSeries(flatten(tests), (test, cbk) => {
          return acceptsChannelOpen({
            capacity: test.capacity,
            cooperative_close_address: test.cooperative_close_address,
            give_tokens: test.give_tokens,
            is_private: test.is_private,
            is_trusted_funding: test.is_trusted_funding,
            lnd: test.lnd,
            partner_public_key: test.partner_public_key,
          },
          cbk);
        },
        cbk);
      }],

      // Determine if internal funding should be used
      isExternal: [
        'capacities',
        'checkAcceptance',
        'connect',
        'getWalletVersion',
        ({getWalletVersion}, cbk) =>
      {
        // Exit early when using internal funding
        if (!!args.internal_fund_fee_rate) {
          return cbk(null, false);
        }

        // Exit early when external directive is supplied
        if (!!args.is_external) {
          return cbk(null, args.is_external);
        }

        // Early versions of LND do not support internal PSBT funding
        if (noInternalFundingVersions.includes(getWalletVersion.version)) {
          return cbk(null, true);
        }

        // Peers are connected - what type of funding will be used?
        args.logger.info(lineBreak);

        // Prompt to make sure that internal funding should be used
        return args.ask({
          default: true,
          message: 'Use internal wallet funds?',
          name: 'internal',
          type: 'confirm',
        },
        ({internal}) => cbk(null, !internal));
      }],

      // Ask for the fee rate to use for internally funded opens
      askForFeeRate: ['isExternal', ({isExternal}, cbk) => {
        // Exit early when there are no internal funds being spent or internal fee rate is specified
        if (!!isExternal || !!args.internal_fund_fee_rate) {
          return cbk(null, {});
        }

        return askForFeeRate({ask: args.ask, lnd: args.lnd}, cbk);
      }],

      // Initiate open requests
      openChannels: [
        'askForFeeRate',
        'capacities',
        'connect',
        'getLnds',
        'getNodes',
        'isExternal',
        'opens',
        ({getLnds, getNodes, opens}, cbk) =>
      {
        // When there are multiple batches, broadcasting must be stopped
        const [, hasMultipleBatches] = opens;

        // Go through each batch and open channels
        return asyncMapSeries(opens, asyncReflect(({channels, node}, cbk) => {
          const {lnd} = getLnds.find(n => n.node === node);

          return openChannels({
            channels,
            lnd,
            is_avoiding_broadcast: true,
          },
          (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            return cbk(null, {lnd, node, pending: res.pending});
          });
        }),
        (err, res) => {
          const openError = res.find(n => !!n.error);
          const opening = res.map(n => n.value).filter(n => !!n);

          if (!!openError) {
            // Cancel past successful batch channel open proposals
            return asyncEach(opening, ({lnd, pending}, cbk) => {
              return asyncEach(pending, ({id}, cbk) => {
                return cancelPendingChannel({id, lnd}, err => {
                  // Suppress errors
                  return cbk();
                });
              },
              cbk);
            },
            () => {
              // Return the original error
              return cbk(openError.error);
            });
          }

          return cbk(null, res.map(n => n.value));
        });
      }],

      // Pending channel outputs
      outputs: ['openChannels', ({openChannels}, cbk) => {
        // All batches will be paid out together in a single tx
        const pending = flatten(openChannels.map(({pending}) => {
          return pending.map(n => ({address: n.address, tokens: n.tokens}));
        }));

        // Sort all the outputs using BIP 69
        try {
            pending.sort((a, b) => {
            // Sort by tokens ascending when no tie breaker needed
            if (a.tokens !== b.tokens) {
              return a.tokens - b.tokens;
            }

            return bech32AsData(a.address).compare(bech32AsData(b.address));
          });
        } catch (err) {}

        return cbk(null, pending);
      }],

      // Detect funding transaction
      detectFunding: [
        'getNetwork',
        'isExternal',
        'openChannels',
        ({getNetwork, isExternal, openChannels}, cbk) =>
      {
        // Exit early when the funding is coming from the internal wallet
        if (!isExternal) {
          return cbk();
        }

        if (!detectNetworks.includes(getNetwork.network)) {
          return cbk();
        }

        const [{pending}] = openChannels;

        const [{address, tokens}] = pending;

        return asyncRetry({
          interval: utxoPollingIntervalMs,
          times: utxoPollingTimes,
        },
        cbk => {
          return getAddressUtxo({
            address,
            tokens,
            network: getNetwork.network,
            request: args.request,
          },
          (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            if (!res.transaction) {
              return cbk([404, 'FailedToFindFundingUtxo']);
            }

            const foundTx = res.transaction;

            return getPsbtFromTransaction({
              network: getNetwork.network,
              request: args.request,
              transaction: foundTx,
            },
            (err, res) => {
              if (!!err) {
                return cbk();
              }

              args.logger.info({
                funding_detected: Transaction.fromHex(foundTx).getId(),
              });

              return asyncEach(openChannels, ({lnd, node, pending}, cbk) => {
                return fundPendingChannels({
                  lnd,
                  channels: pending.map(n => n.id),
                  funding: res.psbt,
                },
                () => cbk());
              },
              cbk);
            });
          });
        },
        () => {
          // Ignore errors
          return cbk();
        });
      }],

      // Prompt for a PSBT or a signed transaction
      getFunding: [
        'askForFeeRate',
        'isExternal',
        'outputs',
        asyncReflect(({askForFeeRate, isExternal, outputs}, cbk) =>
      {
        // Warn external funding that funds are expected within 10 minutes
        if (!!isExternal) {
          args.logger.info({
            funding_deadline: moment().add(10, 'minutes').calendar(),
          });
        }

        const fee = args.internal_fund_fee_rate;

        return getFundedTransaction({
          outputs,
          ask: args.ask,
          chain_fee_tokens_per_vbyte: fee || askForFeeRate.tokens_per_vbyte,
          is_external: isExternal,
          lnd: args.lnd,
          logger: args.logger,
        },
        cbk);
      })],

      // Derive the funding PSBT which is needed for the funding flow
      fundingPsbt: [
        'getFunding',
        'getNetwork',
        'openChannels',
        asyncReflect(({getFunding, getNetwork, openChannels}, cbk) =>
      {
        // Exit early when there was an error with the funding
        if (!!getFunding.error) {
          return cbk(null, {});
        }

        // Maintain a lock on any UTXO inputs until the tx confirms
        if (isArray(getFunding.value.inputs)) {
          maintainUtxoLocks({
            id: getFunding.value.id,
            inputs: getFunding.value.inputs,
            interval: relockIntervalMs,
            lnd: args.lnd,
          },
          () => {});
        }

        // Exit early when there was a PSBT entered and no need to convert a tx
        if (!!getFunding.value.psbt) {
          return cbk(null, {psbt: getFunding.value.psbt});
        }

        return getPsbtFromTransaction({
          network: getNetwork.network,
          request: args.request,
          transaction: getFunding.value.transaction,
        },
        cbk);
      })],

      // Fund the channels using the PSBT
      fundChannels: [
        'fundingPsbt',
        'openChannels',
        'outputs',
        asyncReflect(({fundingPsbt, openChannels, outputs}, cbk) =>
      {
        // Exit early when there is no funding PSBT
        if (!fundingPsbt.value || !fundingPsbt.value.psbt) {
          return cbk(null, {});
        }

        args.logger.info({funding: outputs.map(n => tokAsBigUnit(n.tokens))});

        return asyncMap(openChannels, ({lnd, node, pending}, cbk) => {
          return fundPendingChannels({
            lnd,
            channels: pending.map(n => n.id),
            funding: fundingPsbt.value.psbt,
          },
          cbk);
        },
        cbk);
      })],

      // Get list of trusted channels
      getTrustedChannels: [
        'fundChannels',
        'fundingPsbt',
        'getFunding',
        'openChannels',
        'outputs',
        ({getFunding, openChannels}, cbk) => {
          // Exit early if no trusted channels are being opened
          const trustedChannelsLength = (args.funding_types.filter(n => n === 'true')).length;
          if (!trustedChannelsLength) {
            return cbk(null, []);
          }
          
          return asyncRetry({interval, times: pendingCheckTimes}, cbk => {
            return asyncMap(openChannels, ({lnd, node, pending}, cbk) => {
              return getChannels({lnd}, cbk);
            },
            (err, res) => {
              if (!!err) {
                return cbk([400, 'FailedToGetTrustedChannels']);
              }

              const txId = fromHex(getFunding.value.transaction).getId();
              const trustedChannels = res[0].channels.filter(n => !!n.is_trusted_funding && n.transaction_id === txId);

              if (!trustedChannels.length || trustedChannels.length !== trustedChannelsLength) {
                return cbk([400, 'FailedToFindTrustedChannelsList']);
              }
            
              return cbk(null, trustedChannels);
            },
            cbk)
          },
          cbk);
        }],

      // Broadcast the funding transaction when opening on multiple nodes
      broadcastChainTransaction: [
        'fundChannels',
        'fundingPsbt',
        'getFunding',
        'getTrustedChannels',
        'openChannels',
        ({fundChannels, fundingPsbt, getFunding, getTrustedChannels, openChannels}, cbk) =>
      {
        const fundingError = getFunding.error || fundingPsbt.error;
        const error = fundChannels.error || fundingError;

        // Exit early when the opening had an error and broadcasting isn't safe
        if (!!error || !!fundingError) {
          return cbk();
        }

        const toOpen = flatten(openChannels.map(n => n.pending));
        const txId = fromHex(getFunding.value.transaction).getId();

        args.logger.info({confirming_pending_open: true});

        // Make sure that pending channels are showing up: got commitment tx
        return asyncRetry({interval, times: pendingCheckTimes}, cbk => {
          return asyncMap(openChannels, ({lnd, node, pending}, cbk) => {
            return getPendingChannels({lnd}, cbk);
          },
          (err, res) => {
            if (!!err) {
              return cbk(err);
            }
            // Consolidate all pending channels from all nodes
            const pending = flatten(res.map(n => n.pending_channels));

            // Only consider pending channels related to this funding tx
            const opening = pending.filter(n => n.transaction_id === txId);

            // Every channel to open should be reflected in a pending channel
            if ((opening.length + getTrustedChannels.length) !== toOpen.length) {
              return cbk([503, 'FailedToFindPendingChannelOpen']);
            }

            args.logger.info({broadcasting: getFunding.value.transaction});

            return broadcastChainTransaction({
              lnd: args.lnd,
              transaction: getFunding.value.transaction,
            },
            (err, res) => {
              if (!!err) {
                return cbk(err);
              }

              args.logger.info({broadcast: res.id});

              return cbk();
            });
          });
        },
        cbk);
      }],

      // Cancel pending if there is an error
      cancelPending: [
        'fundChannels',
        'fundingPsbt',
        'getFunding',
        'openChannels',
        ({fundChannels, fundingPsbt, getFunding, openChannels}, cbk) =>
      {
        const fundingError = getFunding.error || fundingPsbt.error;

        const error = fundChannels.error || fundingError;

        // Exit early when there were no errors at any step
        if (!error) {
          return cbk();
        }

        args.logger.info({
          canceling_pending_channels: openChannels.map(({node, pending}) => ({
            node,
            ids: pending.map(n => n.id),
          })),
        });

        return asyncEach(openChannels, ({lnd, pending}, cbk) => {
          return asyncEach(pending => ({id}, cbk) => {
            return cancelPendingChannel({id, lnd}, err => {
              // Ignore errors when trying to cancel a pending channel
              return cbk();
            });
          },
          cbk);
        },
        () => {
          // Return the original error that canceled the finalization
          return cbk(null, error);
        });
      }],

      // Cancel UTXO locks if they are present
      cancelLocks: [
        'cancelPending',
        'getFunding',
        ({cancelPending, getFunding}, cbk) =>
      {
        // Exit early when there is no error that caused a cancel
        if (!cancelPending) {
          return cbk();
        }

        // Exit early when there are no UTXOs to unlock, like external funding
        if (!isArray(getFunding.inputs)) {
          return cbk(cancelPending);
        }

        // Unlock UTXOs locked from internal funding
        return asyncEach(getFunding.inputs, (input, cbk) => {
          // Potentially the UTXO will be relocked with a new id, but attempt
          return unlockUtxo({
            id: input.lock_id,
            lnd: args.lnd,
            transaction_id: input.transaction_id,
            transaction_vout: input.transaction_vout,
          },
          () => {
            //Ignore errors when trying to cancel a locked UTXO, it'll timeout
            return cbk();
          });
        },
        () => {
          // Return the original error that caused the cancel
          return cbk(cancelPending);
        });
      }],

      // Set fee rates
      setFeeRates: [
        'broadcastChainTransaction',
        'cancelLocks',
        'detectFunding',
        'fundChannels',
        'getLnds',
        'opens',
        ({getLnds, opens}, cbk) =>
      {
        // Exit early when not specifying fee rates
        if (args.set_fee_rates.length !== args.public_keys.length) {
          return cbk();
        }

        return asyncEachSeries(opens, ({channels, node}, cbk) => {
          const {lnd} = getLnds.find(n => n.node === node);

          return asyncEachSeries(channels, (channel, cbk) => {
            return adjustFees({
              lnd,
              cltv_delta: undefined,
              fee_rate: channel.rate,
              fs: args.fs,
              logger: args.logger,
              to: [channel.partner_public_key],
            },
            cbk);
          },
          cbk);
        },
        cbk);
      }],

      // Transaction complete
      completed: [
        'broadcastChainTransaction',
        'cancelPending',
        'fundingPsbt',
        'getFunding',
        'setFeeRates',
        ({getFunding, fundingPsbt}, cbk) =>
      {
        return cbk(null, {transaction_id: getFunding.value.id});
      }],
    },
    returnResult({reject, resolve, of: 'completed'}, cbk));
  });
};
