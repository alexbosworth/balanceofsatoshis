const {addPeer} = require('ln-service');
const asyncAuto = require('async/auto');
const asyncDetectSeries = require('async/detectSeries');
const asyncTimeout = require('async/timeout');
const {getChainFeeRate} = require('ln-service');
const {getChannels} = require('ln-service');
const {getClosedChannels} = require('ln-service');
const {getIdentity} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {getNode} = require('ln-service');
const {getPeers} = require('ln-service');
const {getPendingChannels} = require('ln-service');
const {getSeedNodes} = require('ln-sync');
const {openChannel} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const adjustFees = require('./../routing/adjust_fees');
const {getMempoolSize} = require('./../chain');
const {getPastForwards} = require('./../routing');
const peersWithActivity = require('./peers_with_activity');
const {shuffle} = require('./../arrays');

const asBigTok = tokens => (tokens / 1e8).toFixed(8);
const channelTokens = 5e6;
const connectTimeout = 1000 * 30;
const days = 90;
const fastConf = 6;
const {floor} = Math;
const getMempoolRetries = 10;
const maxMempoolSize = 2e6;
const minOutbound = 4294967;
const minForwarded = 1e5;
const regularConf = 72;
const slowConf = 144;

/** Open up a new channel

  {
    [chain_fee_rate]: <Chain Fee Tokens Per VByte to Pay Number>
    [is_dry_run]: <Avoid Actually Opening a New Channel Bool>
    [is_private]: <Mark Channel as Private Booll>
    lnd: <Authenticated LND gRPC API Object>
    logger: <Winston Logger Object>
    [peer]: <Peer Public Key Hex String>
    request: <Request Function>
    [set_fee_rate]: <Fee Rate String>
    [tokens]: <Tokens for New Channel Number>
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.lnd) {
          return cbk([400, 'ExpectedLndObjectToOpenNewChannel']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerObjectToOpenNewChannel']);
        }

        if (!args.request) {
          return cbk([400, 'ExpectedRequestFunctionToOpenNewChannel']);
        }

        return cbk();
      },

      // Get channels
      getChannels: ['validate', ({}, cbk) => {
        return getChannels({lnd: args.lnd}, cbk);
      }],

      // Get closed channels
      getClosed: ['validate', ({}, cbk) => {
        return getClosedChannels({lnd: args.lnd}, cbk);
      }],

      // Get fast fee rate
      getFastFee: ['validate', ({}, cbk) => {
        return getChainFeeRate({
          confirmation_target: fastConf,
          lnd: args.lnd,
        },
        cbk);
      }],

      // Get forwards
      getForwards: ['validate', ({}, cbk) => {
        return getPastForwards({days, lnd: args.lnd}, cbk);
      }],

      // Get network
      getNetwork: ['validate', ({}, cbk) => {
        return getNetwork({lnd: args.lnd}, cbk);
      }],

      // Get normal fee rate
      getNormalFee: ['validate', ({}, cbk) => {
        return getChainFeeRate({
          confirmation_target: regularConf,
          lnd: args.lnd,
        },
        cbk);
      }],

      // Get connected peers
      getPeers: ['validate', ({}, cbk) => getPeers({lnd: args.lnd}, cbk)],

      // Get pending channels
      getPending: ['validate', ({}, cbk) => {
        return getPendingChannels({lnd: args.lnd}, cbk);
      }],

      // Get low fee rate
      getSlowFee: ['validate', ({}, cbk) => {
        return getChainFeeRate({
          confirmation_target: slowConf,
          lnd: args.lnd,
        },
        cbk);
      }],

      // Get wallet identity
      getWallet: ['validate', ({}, cbk) => getIdentity({lnd: args.lnd}, cbk)],

      // Get mempool size
      getMempool: ['getNetwork', ({getNetwork}, cbk) => {
        return getMempoolSize({
          network: getNetwork.network,
          request: args.request,
          retries: getMempoolRetries,
        },
        cbk);
      }],

      // Get seed nodes
      getSeed: ['getNetwork', ({getNetwork}, cbk) => {
        // Exit early when a peer is specified
        if (!!args.peer) {
          return cbk(null, {nodes: []});
        }

        return getSeedNodes({
          network: getNetwork.network,
          request: args.request,
        },
        cbk);
      }],

      // Candidate peers
      candidates: [
        'getChannels',
        'getClosed',
        'getPending',
        'getForwards',
        'getSeed',
        ({getChannels, getClosed, getForwards, getPending, getSeed}, cbk) =>
      {
        const allChannels = []
          .concat(getChannels.channels)
          .concat(getPending.pending_channels.filter(n => !!n.is_opening));

        const {peers} = peersWithActivity({
          additions: [].concat(args.peer).filter(n => !!n),
          channels: allChannels,
          forwards: getForwards.forwards,
          terminated: getClosed.channels,
        });

        // Exit early when a peer is specified
        if (!!args.peer) {
          return cbk(null, peers.filter(n => n.public_key === args.peer));
        }

        const depletedPeers = peers
          .filter(n => n.outbound < minOutbound) // Depleted
          .filter(n => n.forwarded > minForwarded); // Previous forwards

        const scorePeers = peersWithActivity({
          additions: getSeed.nodes.map(n => n.public_key),
          channels: allChannels,
          forwards: getForwards.forwards,
          terminated: getClosed.channels,
        });

        const untriedPeers = scorePeers.peers
          .filter(peer => !peer.outbound)
          .filter(peer => {
            const previous = getClosed.channels.find(n => {
              return peer.public_key === n.partner_public_key;
            });

            return !previous;
          });

        return cbk(null, [].concat(depletedPeers).concat(untriedPeers));
      }],

      // Check if the chain fee rate is high
      checkChainFees: [
        'getFastFee',
        'getMempool',
        'getNormalFee',
        'getSlowFee',
        ({getFastFee, getMempool, getNormalFee, getSlowFee}, cbk) =>
      {
        if (!!args.chain_fee_rate) {
          return cbk();
        }

        const fastFee = getFastFee.tokens_per_vbyte;
        const feeRate = getNormalFee.tokens_per_vbyte;
        const slowFee = getSlowFee.tokens_per_vbyte;

        const estimateRatio = fastFee / slowFee;
        const vbytesRatio = (getMempool.vbytes || Number()) / maxMempoolSize;

        if (!!floor(estimateRatio) && !!floor(vbytesRatio)) {
          return cbk([503, 'FeeRateIsHighNow', {needed_fee_rate: feeRate}]);
        }

        return cbk();
      }],

      // Select a peer and open a channel
      openChannel: [
        'candidates',
        'checkChainFees',
        'getNormalFee',
        'getPeers',
        'getWallet',
        ({candidates, getNormalFee, getPeers, getWallet}, cbk) =>
      {
        if (!candidates.length) {
          return cbk([404, 'NoObviousCandidateForNewChannel']);
        }

        const hasPeer = !!getPeers.peers.find(n => n.public_key === args.peer);

        // Find peer that can be connected to
        return asyncDetectSeries(
          shuffle({array: candidates}).shuffled,
          (candidate, cbk) => {
            // Exit early when the candidate is self
            if (candidate.public_key === getWallet.public_key) {
              return cbk(null, false);
            }

            return getNode({
              is_omitting_channels: true,
              lnd: args.lnd,
              public_key: candidate.public_key,
            },
            (err, res) => {
              const [socket] = !!res && res.sockets ? res.sockets : [];

              // Exit early when there is no socket to connect to
              if (!socket && !hasPeer) {
                return cbk(null, false);
              }

              const node = {
                alias: !!res && !!res.alias ? res.alias : undefined,
                past_forwarded: asBigTok(candidate.forwarded),
                current_inbound: asBigTok(candidate.inbound),
                current_outbound: asBigTok(candidate.outbound),
                public_key: candidate.public_key,
                socket: !!socket ? socket.socket : undefined,
              };

              args.logger.info({
                evaluating: `${node.alias || String()} ${node.public_key}`,
              });

              return asyncTimeout(addPeer, connectTimeout)({
                lnd: args.lnd,
                public_key: node.public_key,
                socket: node.socket,
              },
              err => {
                if (!!err && !hasPeer) {
                  return cbk(null, false);
                }

                const normalFee = getNormalFee.tokens_per_vbyte;

                const feeRate = args.chain_fee_rate || normalFee;

                // Exit early when this is a dry run
                if (!!args.is_dry_run) {
                  args.logger.info({
                    opening_with: node,
                    chain_fee_tokens_per_vbyte: feeRate,
                    is_dry_run: true,
                    new_channel_size: asBigTok(args.tokens || channelTokens),
                  });

                  return cbk(null, true);
                }

                return openChannel({
                  chain_fee_tokens_per_vbyte: feeRate,
                  is_private: args.is_private,
                  lnd: args.lnd,
                  local_tokens: args.tokens || channelTokens,
                  partner_public_key: node.public_key,
                  partner_socket: node.socket,
                },
                (err, res) => {
                  const [, code] = err || [];

                  // Exit early when there is not enough balance
                  if (code === 'InsufficientFundsToCreateChannel') {
                    return cbk(err);
                  }

                  // Exit early when there is only one candidate
                  if (!!err && !!args.peer) {
                    return cbk(err);
                  }

                  // Channel open failure, try a different peer
                  if (!!err) {
                    return cbk(null, false);
                  }

                  args.logger.info({
                    opening_with: node,
                    chain_fee_tokens_per_vbyte: feeRate,
                    transaction_id: res.transaction_id,
                    new_channel_size: asBigTok(args.tokens || channelTokens),
                    is_private: args.is_private || undefined,
                  });

                  return cbk(null, true);
                });
              });
            });
          },
          (err, selected) => {
            if (!!err) {
              return cbk(err);
            }

            if (!selected) {
              return cbk([400, 'FailedToConnectToAnyCandidatePeer']);
            }

            return cbk(null, selected);
          },
        );
      }],

      // Set fee rate
      setFeeRate: ['openChannel', ({openChannel}, cbk) => {
        // Exit early when not specifying fee rates
        if (!args.set_fee_rate) {
          return cbk();
        }

        return adjustFees({
          cltv_delta: undefined,
          fee_rate: args.set_fee_rate,
          fs: args.fs,
          lnd: args.lnd,
          logger: args.logger,
          to: [openChannel.public_key],
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
