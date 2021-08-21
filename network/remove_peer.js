const asyncAuto = require('async/auto');
const asyncEachSeries = require('async/eachSeries');
const {closeChannel} = require('ln-service');
const {getChainFeeRate} = require('ln-service');
const {getChannels} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {returnResult} = require('asyncjs-util');

const {getMempoolSize} = require('./../chain');
const getPeers = require('./get_peers');

const asOutpoint = n => `${n.transaction_id}:${n.transaction_vout}`;
const fastConf = 6;
const {floor} = Math;
const defaultDays = 365 * 2;
const getMempoolRetries = 10;
const {isArray} = Array;
const maxMempoolSize = 2e6;
const regularConf = 72;
const slowConf = 144;

/** Close out channels with a peer and disconnect them

  {
    [address]: <Close Out Funds to On-Chain Address String>
    [chain_fee_rate]: <Chain Fee Per VByte Number>
    fs: {
      getFile: <Read File Contents Function> (path, cbk) => {}
    }
    [idle_days]: <No Activity From Peer For Days Number>
    [inbound_liquidity_below]: <Peer Has Inbound Liquidity Below Tokens Number>
    [is_active]: <Peer Is Actively Connected Bool>
    [is_dry_run]: <Avoid Actually Closing Channel Bool>
    [is_forced]: <Force Close When Cooperative Close Is Impossible Bool>
    [is_offline]: <Peer Is Disconnected Bool>
    [is_private]: <Peer is Privately Connected Bool>
    [is_public]: <Peer is Publicly Connected Bool>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    [omit]: [<Avoid Peer With Public Key String>]
    [outbound_liquidity_below]: <Has Outbound Liquidity Below Tokens Number>
    outpoints: [<Only Remove Specific Channel Funding Outpoint String>]
    [public_key]: <Public Key Hex String>
    request: <Request Function>
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.fs) {
          return cbk([400, 'ExpectedFsMethodsToRemovePeer']);
        }

        if (!args.lnd) {
          return cbk([400, 'LndIsRequiredToRemovePeer']);
        }

        if (!args.logger) {
          return cbk([400, 'LoggerIsRequiredToRemovePeer']);
        }

        if (!isArray(args.outpoints)) {
          return cbk([400, 'ExpectedSpecificOutpointsToRemoveFromPeer']);
        }

        if (!args.request) {
          return cbk([400, 'RequestIsRequiredToRemovePeer']);
        }

        return cbk();
      },

      // Get channels
      getChannels: ['validate', ({}, cbk) => {
        return getChannels({lnd: args.lnd}, cbk);
      }],

      // Get fast fee rate
      getFastFee: ['validate', ({}, cbk) => {
        return getChainFeeRate({
          confirmation_target: fastConf,
          lnd: args.lnd,
        },
        cbk);
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

      // Get peers
      getPeers: ['validate', ({}, cbk) => {
        return getPeers({
          earnings_days: args.idle_days || defaultDays,
          fs: args.fs,
          idle_days: args.idle_days || Number(),
          inbound_liquidity_below: args.inbound_liquidity_below,
          is_active: args.is_active,
          is_offline: args.is_offline,
          is_private: args.is_private,
          is_public: args.is_public,
          is_showing_last_received: true,
          lnd: args.lnd,
          omit: args.omit || [],
          outbound_liquidity_below: args.outbound_liquidity_below,
          sort_by: 'last_activity',
        },
        cbk);
      }],

      // Get low fee rate
      getSlowFee: ['validate', ({}, cbk) => {
        return getChainFeeRate({
          confirmation_target: slowConf,
          lnd: args.lnd,
        },
        cbk);
      }],

      // Check channels for peer to make sure that they can be cleanly closed
      checkChannels: ['getChannels', ({getChannels}, cbk) => {
        // Exit early when a peer is not specified or force closing is OK
        if (!args.public_key || !!args.is_forced) {
          return cbk();
        }

        const [cannotCoopClose] = getChannels.channels.filter(channel => {
          // Ignore channels that are not the specified public key
          if (channel.partner_public_key !== args.public_key) {
            return false;
          }

          // Inactive channels cannot be cooperatively closed
          if (!channel.is_active) {
            return true;
          }

          // Channels with pending payments cannot be cooperatively closed
          if (!!channel.pending_payments.length) {
            return true;
          }

          // Channel with the peer can be cooperatively closed
          return false;
        });

        // Exit with error when there is a channel that cannot be coop closed
        if (!!cannotCoopClose) {
          return cbk([400, 'CannotCurrentlyCooperativelyCloseWithPeer']);
        }

        return cbk();
      }],

      // Get mempool size
      getMempool: ['getNetwork', ({getNetwork}, cbk) => {
        return getMempoolSize({
          network: getNetwork.network,
          request: args.request,
          retries: getMempoolRetries,
        },
        cbk);
      }],

      // Check if the chain fee rate is high
      checkChainFees: [
        'getFastFee',
        'getMempool',
        'getNormalFee',
        'getSlowFee',
        ({getFastFee, getMempool, getNormalFee, getSlowFee}, cbk) =>
      {
        // Exit early when force closing or closing with a set fee rate
        if (!!args.is_forced || !!args.chain_fee_rate) {
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

      // Select a peer
      selectPeer: [
        'checkChainFees',
        'getChannels',
        'getPeers',
        ({getChannels, getPeers}, cbk) =>
      {
        const [peer] = getPeers.peers
          .filter(peer => {
            // Exit early when any peer is eligible
            if (!args.public_key) {
              return true;
            }

            return peer.public_key === args.public_key;
          })
          .filter(peer => {
            // Exit early when force closes are allowed
            if (!args.is_forced) {
              return true;
            }

            const channels = getChannels.channels.filter(channel => {
              return channel.partner_public_key === peer.public_key;
            });

            // Exit early when a channel has a payment in flight
            if (!!channels.find(n => !!n.pending_payments.length)) {
              return false;
            }

            // Exit early when a channel is offline
            if (!!channels.find(n => !n.is_active)) {
              return false;
            }

            return true;
          });

        if (!peer && !!args.public_key) {
          return cbk(null, {public_key: args.public_key});
        }

        return cbk(null, peer);
      }],

      // Determine which channels need to be closed and close them
      channelsToClose: [
        'checkChannels',
        'getChannels',
        'getNormalFee',
        'selectPeer',
        ({getChannels, getNormalFee, selectPeer}, cbk) =>
      {
        // Exit early when there is no peer to close out with
        if (!selectPeer) {
          return cbk([400, 'NoPeerFoundToRemove']);
        }

        const feeRate = args.chain_fee_rate || getNormalFee.tokens_per_vbyte;

        const toClose = getChannels.channels
          .filter(chan => chan.partner_public_key === selectPeer.public_key)
          .filter(chan => {
            if (!args.outpoints.length)  {
              return true;
            }

            return args.outpoints.includes(asOutpoint(chan));
          });

        // Exit early when there are no channels to close
        if (!toClose.length) {
          return cbk([400, 'NoChannelsToCloseWithPeer']);
        }

        args.logger.info({
          close_with_peer: selectPeer,
          channels_to_close: toClose.map(n => n.id),
          fee_rate: !args.is_forced ? feeRate : undefined,
        });

        if (!!args.is_dry_run) {
          args.logger.info({is_dry_run: true});

          return cbk();
        }

        return asyncEachSeries(toClose, (channel, cbk) => {
          const isLocked = !!channel.cooperative_close_address;

          return closeChannel({
            address: !isLocked && !!args.address ? args.address : undefined,
            is_force_close: !channel.is_active,
            lnd: args.lnd,
            tokens_per_vbyte: !!channel.is_active ? feeRate : undefined,
            transaction_id: channel.transaction_id,
            transaction_vout: channel.transaction_vout,
          },
          (err, res) => {
            if (!!err) {
              return cbk([503, 'UnexpectedErrorClosingChannel', {err}]);
            }

            args.logger.info({close_transaction_id: res.transaction_id});

            return cbk();
          });
        },
        cbk);
      }],
    },
    returnResult({reject, resolve, of: 'remove'}, cbk));
  });
};
