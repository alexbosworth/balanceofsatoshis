const {randomBytes} = require('crypto');

const {addPeer} = require('ln-service');
const asyncAuto = require('async/auto');
const asyncEach = require('async/each');
const asyncDetectSeries = require('async/detectSeries');
const asyncMap = require('async/map');
const asyncMapSeries = require('async/mapSeries');
const asyncRetry = require('async/retry');
const {cancelPendingChannel} = require('ln-service');
const {decodePsbt} = require('psbt');
const {extractTransaction} = require('psbt');
const {finalizePsbt} = require('psbt');
const {fundPendingChannels} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {getNode} = require('ln-service');
const {getPeers} = require('ln-service');
const {getWalletVersion} = require('ln-service');
const {green} = require('colorette');
const {openChannels} = require('ln-service');
const moment = require('moment');
const {returnResult} = require('asyncjs-util');
const {Transaction} = require('bitcoinjs-lib');
const {transactionAsPsbt} = require('psbt');

const {getAddressUtxo} = require('./../chain');
const {getRawTransaction} = require('./../chain');
const {parseAmount} = require('./../display');

const addressesHeader = green('Addresses');
const base64AsHex = n => Buffer.from(n, 'base64').toString('hex');
const defaultChannelCapacity = 5e6;
const format = 'p2wpkh';
const getTxRetryCount = 10;
const interrogationSeparator = ' and \n  ';
const {isArray} = Array;
const isHex = n => !!n && !(n.length % 2) && /^[0-9A-F]*$/i.test(n);
const knownTypes = ['private', 'public'];
const makeId = () => randomBytes(32).toString('hex');
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
    gives: [<New Channel Give Tokens Number>]
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    public_keys: [<Public Key Hex String>]
    request: <Request Function>
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
        const publicKeysLength = args.public_keys.length;

        if (!!hasCapacities && publicKeysLength !== args.capacities.length) {
          return cbk([400, 'CapacitiesMustBeSpecifiedForEveryPublicKey']);
        }

        if (!!hasGives && publicKeysLength !== args.gives.length) {
          return cbk([400, 'GivesMustBeSpecifiedForEveryPublicKey']);
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
        return getWalletVersion({lnd: args.lnd}, err => {
          if (!!err) {
            return cbk([400, 'BackingLndCannotBeUsedToOpenChannels', {err}]);
          }

          return cbk();
        });
      }],

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

      // Initiate open requests
      openChannels: [
        'capacities',
        'connect',
        'getWalletVersion',
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

        return openChannels({channels, lnd: args.lnd}, cbk);
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

            const inputs = Transaction.fromHex(foundTx).ins;

            const hashes = inputs.map(n => n.hash.toString('hex'));

            const spendIds = hashes
              .map(n => Buffer.from(n, 'hex').reverse())
              .map(n => n.toString('hex'));

            return asyncMapSeries(spendIds, (id, cbk) => {
              return getRawTransaction({
                id,
                network: getNetwork.network,
                request: args.request,
                retries: getTxRetryCount,
              },
              cbk);
            },
            (err, res) => {
              if (!!err) {
                return cbk(null, {err: [400, 'FailedToGetInputs', {err}]});
              }

              const spending = res.map(n => n.transaction);

              try {
                const {psbt} = transactionAsPsbt({
                  spending,
                  transaction: foundTx,
                });

                finalizePsbt({psbt});
              } catch (err) {
                return cbk([404, 'TransactionCannotHavePsbtDerived']);
              }

              const signed = transactionAsPsbt({
                spending,
                transaction: foundTx,
              });

              args.logger.info({
                funding_detected: Transaction.fromHex(foundTx).getId(),
              });

              return fundPendingChannels({
                channels: openChannels.pending.map(n => n.id),
                funding: finalizePsbt({psbt: signed.psbt}).psbt,
                lnd: args.lnd,
              },
              () => {
                return cbk();
              });
            });
          });
        },
        () => {
          // Ignore errors
          return cbk();
        });
      }],

      // Prompt for a PSBT or a signed transaction
      getFunding: ['openChannels', ({openChannels}, cbk) => {
        args.logger.info({
          funding_deadline: moment().add(10, 'minutes').calendar(),
        });

        const commaSends = openChannels.pending.map(channel => {
          return `${channel.address}, ${tokAsBigUnit(channel.tokens)}`;
        });

        args.logger.info(`\n${addressesHeader}:\n${commaSends.join('\n')}\n`);

        const payTo = openChannels.pending
          .map(channel => {
            return `${tokAsBigUnit(channel.tokens)} to ${channel.address}`;
          })
          .join(interrogationSeparator);

        const or = 'or press enter to cancel funding.\n';

        const funding = {
          message: `Enter signed transaction or PSBT that pays ${payTo} ${or}`,
          name: 'fund',
        };

        return args.ask(funding, ({fund}) => cbk(null, fund));
      }],

      // Translate funding data into hex
      fundingHex: ['getFunding', ({getFunding}, cbk) => {
        // Exit early when there is no funding
        if (!getFunding) {
          return cbk(null, {err: [400, 'ExpectedFundingTransaction']});
        }

        // Exit early when funding data is already hex
        if (isHex(getFunding.trim())) {
          return cbk(null, {hex: getFunding.trim()});
        }

        try {
          return cbk(null, {hex: base64AsHex(getFunding.trim())});
        } catch (err) {
          return cbk(null, {err: [400, 'UnexpectedEncodingForFundingTx']});
        }
      }],

      // Funding PSBT
      fundingPsbt: [
        'fundingHex',
        'getNetwork',
        'openChannels',
        ({fundingHex, getNetwork, openChannels}, cbk) =>
      {
        // Exit early when there was an error with the funding hex
        if (!!fundingHex.err) {
          return cbk(null, {});
        }

        try {
          decodePsbt({psbt: fundingHex.hex});

          // The PSBT is a valid funding PSBT
          return cbk(null, {psbt: fundingHex.hex});
        } catch (err) {}

        try {
          Transaction.fromHex(fundingHex.hex);
        } catch (err) {
          return cbk(null, {err: [400, 'ExpectedValidTxOrPsbtToFundChans']});
        }

        const transaction = fundingHex.hex;

        const {ins} = Transaction.fromHex(transaction);

        const ids = ins.map(n => n.hash.reverse().toString('hex'));

        return asyncMapSeries(ids, (id, cbk) => {
          return getRawTransaction({
            id,
            network: getNetwork.network,
            request: args.request,
            retries: getTxRetryCount,
          },
          cbk);
        },
        (err, res) => {
          if (!!err) {
            return cbk(null, {err: [400, 'FailedToGetFundingInputs', {err}]});
          }

          const spending = res.map(n => n.transaction);

          try {
            const {psbt} = transactionAsPsbt({spending, transaction});

            const finalized = finalizePsbt({psbt});

            return cbk(null, {psbt: finalized.psbt});
          } catch (err) {
            return cbk(null, {err: [400, 'FailedToConvertTxToPsbt', {err}]});
          }
        });
      }],

      // Fund the channels using the PSBT
      fundChannels: [
        'fundingPsbt',
        'openChannels',
        ({fundingPsbt, openChannels}, cbk) =>
      {
        // Exit early when there is no funding PSBT
        if (!fundingPsbt.psbt) {
          return cbk(null, {});
        }

        args.logger.info({
          funding: openChannels.pending.map(n => tokAsBigUnit(n.tokens)),
        });

        return fundPendingChannels({
          channels: openChannels.pending.map(n => n.id),
          funding: fundingPsbt.psbt,
          lnd: args.lnd,
        },
        err => {
          if (!!err) {
            return cbk(null, {err});
          }

          return cbk(null, {});
        });
      }],

      // Cancel pending if there is an error
      cancelPending: [
        'fundChannels',
        'fundingHex',
        'fundingPsbt',
        'openChannels',
        ({fundChannels, fundingHex, fundingPsbt, openChannels}, cbk) =>
      {
        // Exit early when there were no errors
        if (!fundChannels.err && !fundingHex.err && !fundingPsbt.err) {
          return cbk();
        }

        args.logger.info({
          canceling_pending_channels: openChannels.pending.map(n => n.id),
        });

        // Cancel outstanding pending channels when there is an error
        return asyncEach(openChannels.pending, (channel, cbk) => {
          return cancelPendingChannel({id: channel.id, lnd: args.lnd}, () => {
            return cbk();
          });
        },
        () => {
          // Return the error that canceled the finalization
          return cbk(fundChannels.err || fundingHex.err || fundingPsbt.err);
        });
      }],

      // Transaction complete
      completed: [
        'cancelPending',
        'fundingPsbt',
        ({cancelPending, fundingPsbt}, cbk) =>
      {
        try {
          const {transaction} = extractTransaction({psbt: fundingPsbt.psbt});

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
