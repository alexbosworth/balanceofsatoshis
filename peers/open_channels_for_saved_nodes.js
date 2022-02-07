const {randomBytes} = require('crypto');

const {addPeer} = require('ln-service');
const {address} = require('bitcoinjs-lib');
const {askForFeeRate} = require('ln-sync');
const asyncAuto = require('async/auto');
const asyncEach = require('async/each');
const asyncEachSeries = require('async/eachSeries');
const asyncDetectSeries = require('async/detectSeries');
const asyncMap = require('async/map');
const asyncMapSeries = require('async/mapSeries');
const asyncMapValues = require('async/mapValues');
const asyncReflect = require('async/reflect');
const asyncRetry = require('async/retry');
const {cancelPendingChannel} = require('ln-service');
const {decodePsbt} = require('psbt');
const {fundPendingChannels} = require('ln-service');
const {getFundedTransaction} = require('ln-sync');
const {getNetwork} = require('ln-sync');
const {getNode} = require('ln-service');
const {getPeers} = require('ln-service');
const {getPsbtFromTransaction} = require('goldengate');
const {getWalletVersion} = require('ln-service');
const {openChannels} = require('ln-service');
const {maintainUtxoLocks} = require('ln-sync');
const moment = require('moment');
const {returnResult} = require('asyncjs-util');
const {Transaction} = require('bitcoinjs-lib');
const {transactionAsPsbt} = require('psbt');
const {unlockUtxo} = require('ln-service');

const adjustFees = require('./../routing/adjust_fees');
const channelsFromArguments = require('./channels_from_arguments');
const {getAddressUtxo} = require('./../chain');
const {parseAmount} = require('./../display');

const bech32AsData = bech32 => address.fromBech32(bech32).data;
const defaultChannelCapacity = 5e6;
const format = 'p2wpkh';
const {isArray} = Array;
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const lineBreak = '\n';
const knownTypes = ['private', 'public'];
const noInternalFundingVersions = ['0.11.0-beta', '0.11.1-beta'];
const notFound = -1;
const peerAddedDelayMs = 1000 * 5;
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
    gives: [<New Channel Give Tokens Number>]
    [is_external]: <Use External Funds to Open Channels Bool>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
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

        if (!isArray(args.gives)) {
          return cbk([400, 'ExpectedArrayOfGivesToOpenChannels']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToInitiateOpenChannelRequests']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToInitiateOpenChannelRequests']);
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
        const publicKeysLength = args.public_keys.length;
        const hasOpeningNodes = !!args.opening_nodes.length;

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

        if (!!hasOpeningNodes && publicKeysLength !== args.opening_nodes.length) {
          return cbk([400, 'MustSetOpeningNodeForEveryPublicKey']);
        }

        if (!args.request) {
          return cbk([400, 'ExpectedRequestFunctionToOpenChannels']);
        }

        if (!isArray(args.types)) {
          return cbk([400, 'ExpectedArrayOfTypesToOpenChannels']);
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
      
      //Map each pubkey to each opening lnd or default lnd if no opening node is specified
      mapPubkeysToLnds: ['capacities', 'validate', ({capacities}, cbk) => {
        const mappedKeysToLnds = [];

        const coopCloseAddress = args.cooperative_close_addresses;
        const defaultLnd = args.lnd;
        const gives = args.gives;
        const openingNodes = args.opening_nodes;
        const openingNodesLnds = args.opening_node_lnds;
        const publicKeys = args.public_keys;
        const types = args.types;

        publicKeys.forEach((publicKey, i) => {
          const obj = new Object();
          obj.capacity = capacities[i] || undefined;
          obj.cooperative_close_address = coopCloseAddress[i] || undefined;
          obj.give = gives[i] || undefined;
          obj.lnd = openingNodesLnds[i] || defaultLnd;
          obj.opening_node_name = openingNodes[i] || undefined;
          obj.public_key = publicKey;
          obj.type = types[i] || undefined;

          mappedKeysToLnds.push(obj);
        });
        return cbk(null, mappedKeysToLnds);
      }],

      // Get the default network name
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd: args.lnd}, cbk)],

      getOpeningNodesNetwork: ['validate', ({}, cbk) => {
        //Exit early if no opening saved nodes
        if (!args.opening_nodes || !args.opening_nodes.length) {
          return cbk();
        }
        asyncMap(args.opening_node_lnds, (node, cbk) => {
          return getNetwork({lnd: node}, (err, res) => {
            if (!!err) {
              return cbk(err);
            }
            return cbk(null, res);
          });
        },
        cbk);

      }],

      // Check if all networks are the same
      checkNetworks: [
        'getNetwork', 
        'getOpeningNodesNetwork', 
        ({getNetwork, getOpeningNodesNetwork}, cbk) => {
        //Exit early if no opening saved nodes
        if (!args.opening_nodes || !args.opening_nodes.length) {
          return cbk();
        }
        const networks = [getNetwork, ...getOpeningNodesNetwork];
      
        const checkNetwork = networks.every((n, i, arr) => n.network === arr[0].network && n.bitcoinjs === arr[0].bitcoinjs);
          if (!checkNetwork) {
            return cbk([400, 'AllNodesMustBeOnTheSameNetwork']);
          }
        
        return cbk();
      
      }],

      // Get node details for each public key and sockets to connect if we need to
      getNodes: [
        'checkNetworks', 
        'mapPubkeysToLnds', 
        'validate', 
        ({mapPubkeysToLnds}, cbk) => {
        return asyncMap((mapPubkeysToLnds), (map, cbk) => {
          return getNode({lnd: map.lnd, public_key: map.public_key}, (err, res) => {
            if (!!err) {
              return cbk(null, {public_key: map.public_key, sockets: []});
            }
            const peers = res.channels.map(({policies}) => {
              return policies.find(n => n.public_key !== map.public_key).public_key;
            });

            const isBig = res.features.find(n => n.type === 'large_channels');

            return cbk(null, {
              alias: res.alias,
              capacity: map.capacity,
              channels_count: res.channels.length,
              coop_close_address: map.coop_close_address,
              give: map.give,
              is_accepting_large_channels: !!isBig || undefined,
              opening_node_lnd: map.lnd,
              opening_node_name: map.opening_node_name,
              peers_count: uniq(peers).length,
              public_key: map.public_key,
              sockets: res.sockets,
              type: map.type,
            });
          });
        },
        cbk);
      }],

      // Display opening message
      openingMessage: [
        'getNodes',
        'mapPubkeysToLnds',
        ({capacities, getNodes}, cbk) =>
      {
        const {channels} = channelsFromArguments({
          capacities,
          addresses: args.cooperative_close_addresses,
          gives: args.gives,
          nodes: args.public_keys,
          types: args.types,
        });

        const nodes = getNodes.filter(n => !!n.channels_count).map(node => {
          return {
            node: `${node.alias || node.public_key}`,
            opening_saved_node_name: node.opening_node_name,
            channels_per_peer: `${per(node.channels_count, node.peers_count)}`,
            is_accepting_large_channels: node.is_accepting_large_channels,
          };
        });

        args.logger.info(nodes);

        const openingTo = getNodes.map(node => {
          const {capacity} = channels.find(channel => {
            return channel.partner_public_key === node.public_key;
          });
          if (!!args.opening_nodes && !!args.opening_nodes.length) {
            return `${node.alias || node.public_key}: ${tokAsBigUnit(capacity)} from ${node.opening_node_name}`;
          } else {
            return `${node.alias || node.public_key}: ${tokAsBigUnit(capacity)}`;
          }
        });

        args.logger.info({opening_to: openingTo});

        return cbk();
      }],

      // Get peers, check if already connected and connect if required
      connect: ['getNodes', ({getNodes}, cbk) => {
        return asyncEach((getNodes), (node, cbk) => {
          return getPeers({lnd: node.opening_node_lnd}, (err, res) => {
            if (!!err) {
              return cbk(err);
            }
              // Exit early when the peer is already connected
              if (res.peers.map(n => n.public_key).includes(node.public_key)) {
                return cbk();
              }
    
              if (!node.sockets.length) {
                return cbk([503, 'NoAddressFoundToConnectToNode', {node}]);
              }

            if (!!args.opening_nodes && !!args.opening_nodes.length) {
                  args.logger.info({
                    connecting_to: {alias: node.alias, public_key: node.public_key, from: node.opening_node_name},
                  });
              } else {
                  args.logger.info({
                  connecting_to: {alias: node.alias, public_key: node.public_key},
                });
              }

              return asyncRetry({times}, cbk => {
                return asyncDetectSeries(node.sockets, ({socket}, cbk) => {
                  return addPeer({socket, lnd: node.opening_node_lnd, public_key: node.public_key}, err => {
                    return cbk(null, !err);
                  });
                },
                (err, res) => {
                  if (!!err) {
                    return cbk(err);
                  }
    
                  if (!res) {
                    return cbk([503, 'FailedToConnectToPeer', ({peer: node.public_key})]);
                  }
    
                  return setTimeout(() => cbk(null, true), peerAddedDelayMs);
                });
              },
              cbk);
          });
        },
        cbk);
      }],

      // Get the wallet version and check if it is compatible
      getWalletVersion: ['validate', ({}, cbk) => {
        return getWalletVersion({lnd: args.lnd}, (err, res) => {
          if (!!err) {
            return cbk([400, 'BackingLndCannotBeUsedToOpenChannels', {err}]);
          }

          return cbk(null, {version: res.version});
        });
      }],

      // Check all nodes that they will allow an inbound channel
      checkAcceptance: [
        'capacities',
        'connect',
        'getNodes',
        ({capacities, connect, getNodes}, cbk) => 
      {
        const {channels} = channelsFromArguments({
          capacities,
          addresses: args.cooperative_close_addresses,
          gives: args.gives,
          nodes: args.public_keys,
          types: args.types,
        });

        return asyncEachSeries(getNodes, (node, cbk) => {
          const to = node.public_key;
          const channel = {
            capacity: node.capacity || defaultChannelCapacity,
            cooperative_close_address: node.coop_close_address || undefined,
            give: !!node.give ? Number(node.give) : undefined,
            partner_public_key: node.public_key,
            is_private: !!node.type && node.type === 'private'
          }

          return openChannels({
            channels: [channel],
            lnd: node.opening_node_lnd,
          },
          (err, res) => {
            if (!!err) {
              return cbk([503, 'UnexpectedErrorProposingChannel', {to, err}]);
            }
            
            const [{id}] = res.pending;
            
            return cancelPendingChannel({id, lnd: node.opening_node_lnd}, (err, res) => {
              if (!!err) {
                return cbk([503, 'UnexpectedErrorCancelingChannel', {err}]);
              }
              
              return cbk(null, false);
            });
          });
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

        // Prompt to make sure that internal funding should really be used
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
        // Exit early when there are no internal funds being spent
        if (!!isExternal) {
          return cbk(null, {});
        }

        return askForFeeRate({ask: args.ask, lnd: args.lnd}, cbk);
      }],

      // Initiate open requests
      openChannels: [
        'askForFeeRate',
        'capacities',
        'connect',
        'getNodes',
        'getWalletVersion',
        'isExternal',
        ({capacities, getNodes}, cbk) =>
      {
        const {channels} = channelsFromArguments({
          capacities,
          addresses: args.cooperative_close_addresses,
          gives: args.gives,
          nodes: args.public_keys,
          types: args.types,
        });
        let i = 0;
        return asyncMapSeries(getNodes, (node, cbk) => { 
          i++;
          const to = node.public_key;

          const channel = {
            capacity: node.capacity || defaultChannelCapacity,
            cooperative_close_address: node.coop_close_address || undefined,
            give: !!node.give ? Number(node.give) : undefined,
            partner_public_key: to,
            is_private: !!node.type && node.type === 'private'
          }
          return openChannels({
            channels: [channel], 
            lnd: node.opening_node_lnd,
            // is_avoiding_broadcast: i === getNodes.length ? false : true,
          }, (err, res) => {
            if (!!err) {
              return cbk(err);
            }
            i++;
            const pending = res.pending.slice();
  
            // Sort outputs using BIP 69
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
          });
        },
        cbk);
      }],

      // Detect funding transaction
      detectFunding: [
        'getNetwork',
        'openChannels',
        'getNodes',
        ({getNetwork, openChannels, getNodes}, cbk) =>
      {
        return asyncRetry({
          interval: utxoPollingIntervalMs,
          times: utxoPollingTimes,
        },
        cbk => {
          let i = 0;
          return asyncEachSeries(openChannels, (channel, cbk) => {
            i++;
            const [{address, tokens}] = channel;
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
                const [{id}] = channel;
                return fundPendingChannels({
                  channels: [id],
                  funding: res.psbt,
                  lnd: getNodes[i].opening_node_lnd,
                },
                () => cbk());
              });
            });
          },
          cbk);
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
        'openChannels',
        asyncReflect(({askForFeeRate, isExternal, openChannels}, cbk) =>
      {
        // Warn external funding that funds are expected within 10 minutes
        if (!!isExternal) {
          args.logger.info({
            funding_deadline: moment().add(10, 'minutes').calendar(),
          });
        }
        const outputs = [];
        openChannels.forEach(n => {
          const [{address}] = n;
          const [{tokens}] = n;
          outputs.push({
            address,
            tokens,
          });
        });

        return getFundedTransaction({
          ask: args.ask,
          chain_fee_tokens_per_vbyte: askForFeeRate.tokens_per_vbyte,
          is_external: isExternal,
          lnd: args.lnd,
          logger: args.logger,
          outputs,
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
        'getNodes',
        asyncReflect(({fundingPsbt, openChannels, getNodes}, cbk) =>
      {
        // Exit early when there is no funding PSBT
        if (!fundingPsbt.value || !fundingPsbt.value.psbt) {
          return cbk(null, {});
        }

        args.logger.info({
          funding: openChannels,
        });

        let i =0;
        return asyncMapSeries(openChannels, (channel, cbk) => {
          const [{id}] = channel;

          return fundPendingChannels({
            channels: [id],
            funding: fundingPsbt.value.psbt,
            lnd: getNodes[i].opening_node_lnd,
          },
          (err, res) => {
            i++;
            if (!!err) {
              return cbk(err);
            }
            return cbk(null, res);
          });
        },
        cbk);

      })],

      // Cancel pending if there is an error
      cancelPending: [
        'fundChannels',
        'fundingPsbt',
        'getFunding',
        'getNodes',
        'openChannels',
        ({fundChannels, fundingPsbt, getFunding, openChannels, getNodes}, cbk) =>
      {
        const fundingError = getFunding.error || fundingPsbt.error;

        const error = fundChannels.error || fundingError;

        // Exit early when there were no errors at any step
        if (!error) {
          return cbk();
        }

        args.logger.info({
          canceling_pending_channels: openChannels,
        });

        let i =0;
        // Cancel outstanding pending channels when there is an error
        return asyncEachSeries(openChannels, (channel, cbk) => {
          const [{id}] = channel;
          return cancelPendingChannel({id: id, lnd: getNodes[i].opening_node_lnd}, (err, res) => {
            i++;
            // Ignore errors when trying to cancel a pending channel
            return cbk();
          });
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

        // Exit early when there is no UTXOs to unlock
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
        'cancelPending',
        'detectFunding',
        'fundChannels',
        'getNodes',
        ({getNodes}, cbk) =>
      {
        // Exit early when not specifying fee rates
        if (args.set_fee_rates.length !== args.public_keys.length) {
          return cbk();
        }

        const feesToSet = args.set_fee_rates.map((rate, i) => ({
          rate,
          public_key: args.public_keys[i],
        }));

        let i = -1;
        return asyncEachSeries(feesToSet, (toSet, cbk) => {
          i++;
          return adjustFees({
            fee_rate: toSet.rate,
            fs: args.fs,
            lnd: getNodes[i].opening_node_lnd,
            logger: args.logger,
            to: [toSet.public_key],
          },
          cbk);
        },
        cbk);
      }],

      // Transaction complete
      completed: [
        'cancelPending',
        'fundingPsbt',
        'getFunding',
        'setFeeRates',
        ({getFunding, fundingPsbt}, cbk) =>
      {
        try {
          const tx = getFunding.value.transaction;

          const decoded = decodePsbt({psbt: fundingPsbt.value.psbt});

          const transaction = tx || decoded.unsigned_transaction;

          return cbk(null, {
            transaction_id: Transaction.fromHex(transaction).getId(),
          });
        } catch (err) {
          return cbk([503, 'UnexpectedErrorGettingTransactionId', {err}]);
        }
      }],
    },
    returnResult({reject, resolve, of: 'completed'}, cbk));
  });
};
