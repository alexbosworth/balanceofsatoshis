const {randomBytes} = require('crypto');

const {addPeer} = require('ln-service');
const {address} = require('bitcoinjs-lib');
const {askForFeeRate} = require('goldengate');
const asyncAuto = require('async/auto');
const asyncEach = require('async/each');
const asyncEachSeries = require('async/eachSeries');
const asyncDetectSeries = require('async/detectSeries');
const asyncMap = require('async/map');
const asyncReflect = require('async/reflect');
const asyncRetry = require('async/retry');
const {cancelPendingChannel} = require('ln-service');
const {decodePsbt} = require('psbt');
const {fundPendingChannels} = require('ln-service');
const {getFundedTransaction} = require('goldengate');
const {getNetwork} = require('ln-sync');
const {getNode} = require('ln-service');
const {getPeers} = require('ln-service');
const {getPsbtFromTransaction} = require('goldengate');
const {getWalletVersion} = require('ln-service');
const {openChannels} = require('ln-service');
const moment = require('moment');
const {returnResult} = require('asyncjs-util');
const {Transaction} = require('bitcoinjs-lib');
const {transactionAsPsbt} = require('psbt');

const adjustFees = require('./../routing/adjust_fees');
const {getAddressUtxo} = require('./../chain');
const {parseAmount} = require('./../display');

const bech32AsData = bech32 => address.fromBech32(bech32).data;
const defaultChannelCapacity = 5e6;
const format = 'p2wpkh';
const {isArray} = Array;
const lineBreak = '\n';
const knownTypes = ['private', 'public'];
const noInternalFundingVersions = ['0.11.0-beta', '0.11.1-beta'];
const notFound = -1;
const peerAddedDelayMs = 1000 * 5;
const per = (a, b) => (a / b).toFixed(2);
const times = 10;
const tokAsBigUnit = tokens => (tokens / 1e8).toFixed(8);
const uniq = arr => Array.from(new Set(arr));
const utxoPollingIntervalMs = 1000 * 30;
const utxoPollingTimes = 20;

/** Open channels with peers

  {
    ask: <Ask For Input Function>
    capacities: [<New Channel Capacity Tokens String>]
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

        const hasCapacities = !!args.capacities.length;
        const hasGives = !!args.gives.length;
        const hasFeeRates = !!args.set_fee_rates.length;
        const publicKeysLength = args.public_keys.length;

        if (!!hasCapacities && publicKeysLength !== args.capacities.length) {
          return cbk([400, 'CapacitiesMustBeSpecifiedForEveryPublicKey']);
        }

        if (!!hasGives && publicKeysLength !== args.gives.length) {
          return cbk([400, 'GivesMustBeSpecifiedForEveryPublicKey']);
        }

        if (!!hasFeeRates && publicKeysLength !== args.set_fee_rates.length) {
          return cbk([400, 'MustSetFeeRateForEveryPublicKey']);
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

      // Get network name
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd: args.lnd}, cbk)],

      // Get sockets in case we need to connect
      getNodes: ['validate', ({}, cbk) => {
        return asyncMap(uniq(args.public_keys), (key, cbk) => {
          return getNode({lnd: args.lnd, public_key: key}, (err, res) => {
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

      // Get connected peers to see if we are already connected
      getPeers: ['validate', ({}, cbk) => getPeers({lnd: args.lnd}, cbk)],

      // Get the wallet version and check if it is compatible
      getWalletVersion: ['validate', ({}, cbk) => {
        return getWalletVersion({lnd: args.lnd}, (err, res) => {
          if (!!err) {
            return cbk([400, 'BackingLndCannotBeUsedToOpenChannels', {err}]);
          }

          return cbk(null, {version: res.version});
        });
      }],

      // Connect up to the peers
      connect: [
        'capacities',
        'getNodes',
        'getPeers',
        ({capacities, getNodes, getPeers}, cbk) =>
      {
        const channels = args.public_keys.map((key, i) => {
          const total = capacities[i] || defaultChannelCapacity;

          return {total, public_key: key};
        });

        const nodes = getNodes.filter(n => !!n.channels_count).map(node => {
          return {
            node: `${node.alias || node.public_key}`,
            channels_per_peer: `${per(node.channels_count, node.peers_count)}`,
            is_accepting_large_channels: node.is_accepting_large_channels,
          };
        });

        args.logger.info(nodes);

        const openingTo = getNodes.map(node => {
          const {total} = channels.find(n => n.public_key === node.public_key);

          return `${node.alias || node.public_key}: ${tokAsBigUnit(total)}`;
        });

        args.logger.info({opening_to: openingTo});

        return asyncEach(args.public_keys, (key, cbk) => {
          // Exit early when the peer is already connected
          if (getPeers.peers.map(n => n.public_key).includes(key)) {
            return cbk();
          }

          const node = getNodes.find(n => n.public_key === key);

          if (!node.sockets.length) {
            return cbk([503, 'NoAddressFoundToConnectToNode', {node}]);
          }

          args.logger.info({
            connecting_to: {alias: node.alias, public_key: node.public_key},
          });

          return asyncRetry({times}, cbk => {
            return asyncDetectSeries(node.sockets, ({socket}, cbk) => {
              return addPeer({socket, lnd: args.lnd, public_key: key}, err => {
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
      }],

      // Determine if internal funding should be used
      isExternal: [
        'capacities',
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
        'capacities',
        'connect',
        'getWalletVersion',
        'isExternal',
        ({capacities}, cbk) =>
      {
        const channels = args.public_keys.map((key, i) => {
          const capacity = capacities[i] || defaultChannelCapacity;
          const give = args.gives[i] || undefined;
          const type = args.types[i] || undefined;

          return {
            capacity,
            give_tokens: give,
            is_private: !!type && type === 'private',
            partner_public_key: key,
          };
        });

        return openChannels({channels, lnd: args.lnd}, (err, res) => {
          if (!!err) {
            return cbk(err);
          }

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

          return cbk(null, {pending});
        });
      }],

      // Detect funding transaction
      detectFunding: [
        'getNetwork',
        'openChannels',
        ({getNetwork, openChannels}, cbk) =>
      {
        return asyncRetry({
          interval: utxoPollingIntervalMs,
          times: utxoPollingTimes,
        },
        cbk => {
          const [{address, tokens}] = openChannels.pending;

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

              return fundPendingChannels({
                channels: openChannels.pending.map(n => n.id),
                funding: res.psbt,
                lnd: args.lnd,
              },
              () => cbk());
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
        'openChannels',
        asyncReflect(({askForFeeRate, isExternal, openChannels}, cbk) =>
      {
        // Warn external funding that funds are expected within 10 minutes
        if (!!isExternal) {
          args.logger.info({
            funding_deadline: moment().add(10, 'minutes').calendar(),
          });
        }

        return getFundedTransaction({
          ask: args.ask,
          chain_fee_tokens_per_vbyte: askForFeeRate.tokens_per_vbyte,
          is_external: isExternal,
          lnd: args.lnd,
          logger: args.logger,
          outputs: openChannels.pending.map(({address, tokens}) => ({
            address,
            tokens,
          })),
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
        asyncReflect(({fundingPsbt, openChannels}, cbk) =>
      {
        // Exit early when there is no funding PSBT
        if (!fundingPsbt.value || !fundingPsbt.value.psbt) {
          return cbk(null, {});
        }

        args.logger.info({
          funding: openChannels.pending.map(n => tokAsBigUnit(n.tokens)),
        });

        return fundPendingChannels({
          channels: openChannels.pending.map(n => n.id),
          funding: fundingPsbt.value.psbt,
          lnd: args.lnd,
        },
        cbk);
      })],

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
          canceling_pending_channels: openChannels.pending.map(n => n.id),
        });

        // Cancel outstanding pending channels when there is an error
        return asyncEach(openChannels.pending, (channel, cbk) => {
          return cancelPendingChannel({id: channel.id, lnd: args.lnd}, () => {
            // Ignore errors when trying to cancel a pending channel
            return cbk();
          });
        },
        () => {
          // Return the original error that canceled the finalization
          return cbk(error);
        });
      }],

      // Set fee rates
      setFeeRates: [
        'cancelPending',
        'detectFunding',
        'fundChannels',
        ({}, cbk) =>
      {
        // Exit early when not specifying fee rates
        if (args.set_fee_rates.length !== args.public_keys.length) {
          return cbk();
        }

        const feesToSet = args.set_fee_rates.map((rate, i) => ({
          rate,
          public_key: args.public_keys[i],
        }));

        return asyncEachSeries(feesToSet, (toSet, cbk) => {
          return adjustFees({
            fee_rate: toSet.rate,
            fs: args.fs,
            lnd: args.lnd,
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
        'setFeeRates',
        ({fundingPsbt}, cbk) =>
      {
        try {
          const decoded = decodePsbt({psbt: fundingPsbt.value.psbt});

          const transaction = decoded.unsigned_transaction;

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
