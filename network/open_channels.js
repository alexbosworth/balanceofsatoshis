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
const {getNode} = require('ln-service');
const {getPeers} = require('ln-service');
const {getWalletVersion} = require('ln-service');
const {openChannels} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {Transaction} = require('bitcoinjs-lib');
const {transactionAsPsbt} = require('psbt');

const {getAddressUtxo} = require('./../chain');
const {getRawTransaction} = require('./../chain');
const getNetwork = require('./../network/get_network');

const base64AsHex = n => Buffer.from(n, 'base64').toString('hex');
const defaultChannelCapacity = 5e6;
const format = 'p2wpkh';
const getTxRetryCount = 10;
const interrogationSeparator = ' and \n  ';
const {isArray} = Array;
const isHex = n => !!n && !(n.length % 2) && /^[0-9A-F]*$/i.test(n);
const makeId = () => randomBytes(32).toString('hex');
const tokAsBigUnit = tokens => (tokens / 1e8).toFixed(8);
const uniq = arr => Array.from(new Set(arr));
const utxoPollingIntervalMs = 1000 * 30;
const utxoPollingTimes = 20;

/** Open channels with peers

  {
    ask: <Ask For Input Function>
    capacities: [<New Channel Capacity Tokens Number>]
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    public_keys: [<Public Key Hex String>]
    request: <Request Function>
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
        const publicKeysLength = args.public_keys.length;

        if (!!hasCapacities && publicKeysLength !== args.capacities.length) {
          return cbk([400, 'CapacitiesMustBeSpecifiedForEveryPublicKey']);
        }

        if (!args.request) {
          return cbk([400, 'ExpectedRequestFunctionToOpenChannels']);
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

            return cbk(null, {
              alias: res.alias,
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

      // Connect up to the peers
      connect: ['getNodes', 'getPeers', ({getNodes, getPeers}, cbk) => {
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
              return cbk([503, 'FailedToConnectToPeer', ({public_key: key})]);
            }

            return cbk(null, true);
          });
        },
        cbk);
      }],

      // Initiate open requests
      openChannels: ['connect', 'getWalletVersion', ({}, cbk) => {
        const channels = args.public_keys.map((key, i) => {
          const capacity = args.capacities[i] || defaultChannelCapacity;

          return {capacity, partner_public_key: key};
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
        const payTo = openChannels.pending
          .map(channel => {
            return `${tokAsBigUnit(channel.tokens)} to ${channel.address}`;
          })
          .join(interrogationSeparator);

        const funding = {
          message: `Enter signed transaction or PSBT that pays ${payTo}`,
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
