const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {bold} = require('colorette');
const {formatTokens} = require('ln-sync');
const {getChannels} = require('ln-service');
const {getClosedChannels} = require('ln-service');
const {getForwards} = require('ln-service');
const {getHeight} = require('ln-service');
const {getPendingChannels} = require('ln-service');
const {getNode} = require('ln-service');
const {getNodeAlias} = require('ln-sync');
const {returnResult} = require('asyncjs-util');
const size = require('window-size');

const {chartAliasForPeer} = require('./../display');
const {getIcons} = require('./../display');
const isRelevantForward = require('./is_relevant_forward');
const isRelevantSource = require('./is_relevant_source');
const {lndCredentials} = require('./../lnd');

const lastTime = times => !times.length ? null : new Date(max(...times));
const limit = 99999;
const {max} = Math;
const {min} = Math;
const msPerDay = 1000 * 60 * 60 * 24;
const notNull = array => array.filter(n => n !== null);
const {now} = Date;
const numDays = 1;
const {parse} = Date;
const sort = (a, b) => a > b ? 1 : ((b > a) ? -1 : 0);
const sortsForEarning = ['earned_in', 'earned_out', 'earned_total'];
const sortsForCapital = ['inbound', 'liquidity', 'outbound'];
const tokensAsBigTokens = tokens => !!tokens ? (tokens / 1e8).toFixed(8) : '';
const uniq = arr => Array.from(new Set(arr));
const wideSizeCols = 155;

/** Get recent forwarding activity

  {
    [days]: <Days Number>
    fs: {
      getFile: <Read File Contents Function> (path, cbk) => {}
    }
    [is_monochrome]: <Mute Colors Bool>
    [is_table]: <Return Results As Table Bool>
    lnd: <Authenticated LND API Object>
    [sort]: <Sort By Field String>
  }

  @returns via cbk or Promise
  {
    peers: [{
      alias: <Peer Alias String>
      earned_inbound_fees: <Earned Inbound Fee Tokens Number>
      earned_outbound_fees: <Earned Outbound Fee Tokens Number>
      last_inbound_at: <Last Inbound Forward At ISO 8601 Date String>
      last_outbound_at: <Last Forward At ISO 8601 Date String>
      liquidity_inbound: <Inbound Liquidity Big Tokens Number>
      outbound_liquidity: <Outbound Liquidity Big Tokens Number>
      public_key: <Public Key String>
    }]
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.fs) {
          return cbk([400, 'ExpectedFsMethodsToGetForwardingInformation']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToGetForwardingInformation']);
        }

        const sorts = [].concat(sortsForCapital).concat(sortsForEarning);

        if (!!args.sort && !sorts.includes(args.sort)) {
          return cbk([400, 'ExpectedKnownSortToSortForwards', {sorts}]);
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

      // Get forwards
      getForwards: ['validate', ({}, cbk) => {
        const before = new Date().toISOString();
        const pastMs = (args.days || numDays) * msPerDay;

        const after = new Date(now() - pastMs).toISOString();

        return getForwards({after, before, limit, lnd: args.lnd}, cbk);
      }],

      // Get current block height
      getHeight: ['validate', ({}, cbk) => getHeight({lnd: args.lnd}, cbk)],

      // Get node icons
      getIcons: ['validate', ({}, cbk) => getIcons({fs: args.fs}, cbk)],

      // Get pending channels
      getPending: ['validate', ({}, cbk) => {
        return getPendingChannels({lnd: args.lnd}, cbk);
      }],

      // Consolidate closed and open channels
      channels: [
        'getChannels',
        'getClosed',
        ({getChannels, getClosed}, cbk) =>
      {
        const channels = []
          .concat(getChannels.channels)
          .concat(getClosed.channels)
          .filter(n => !!n.id && !!n.partner_public_key);

        return cbk(null, channels);
      }],

      // Forwards from peers
      sendingFromPeers: [
        'channels',
        'getForwards',
        ({channels, getForwards}, cbk) =>
      {
        const forwardingChannels = channels.filter(({id}) => {
          return !!getForwards.forwards.find(n => n.incoming_channel === id);
        });

        return cbk(null, forwardingChannels.map(n => n.partner_public_key));
      }],

      // Forwards to peers
      sendingToPeers: [
        'channels',
        'getForwards',
        ({channels, getForwards}, cbk) =>
      {
        const forwardingChannels = channels.filter(({id}) => {
          return !!getForwards.forwards.find(n => n.outgoing_channel === id);
        });

        return cbk(null, forwardingChannels.map(n => n.partner_public_key));
      }],

      // Node metadata
      nodes: [
        'sendingFromPeers',
        'sendingToPeers',
        ({sendingFromPeers, sendingToPeers}, cbk) =>
      {
        const nodes = uniq([].concat(sendingFromPeers).concat(sendingToPeers));

        return asyncMap(nodes, (id, cbk) => {
          return getNodeAlias({id, lnd: args.lnd}, cbk);
        },
        cbk);
      }],

      // Forwards
      forwards: [
        'channels',
        'getChannels',
        'getForwards',
        'getIcons',
        'getPending',
        'nodes',
        ({
          channels,
          getChannels,
          getForwards,
          getIcons,
          getPending,
          nodes,
        },
        cbk) =>
      {
        const peers = nodes.map(node => {
          // Get the channels that are associated with this peer
          const nodeChannels = channels
            .filter(n => n.partner_public_key === node.id);

          const forwards = getForwards.forwards.filter(forward => {
            return isRelevantForward({
              all_channels: channels,
              from: args.from,
              incoming_channel: forward.incoming_channel,
              node_channels: nodeChannels,
              outgoing_channel: forward.outgoing_channel,
              to: args.to,
            });
          });

          const sources = getForwards.forwards.filter(forward => {
            return isRelevantSource({
              all_channels: channels,
              from: args.from,
              incoming_channel: forward.incoming_channel,
              node_channels: nodeChannels,
              outgoing_channel: forward.outgoing_channel,
              to: args.to,
            });
          });

          const forwardTimes = forwards.map(n => parse(n.created_at));
          const inboundTimes = sources.map(n => parse(n.created_at));

          const lastOut = lastTime(forwardTimes);
          const lastIn = lastTime(inboundTimes);

          const connected = getChannels.channels
            .filter(n => n.partner_public_key === node.id);

          const active = connected.filter(n => n.is_active);

          const isHidden = !active.find(n => !n.is_private) && !!active.length;

          const pending = getPending.pending_channels
            .filter(n => n.is_opening)
            .filter(n => n.partner_public_key === node.id);

          const hasHtlcChannel = connected
            .find(n => !!n.pending_payments.length);

          const local = [].concat(nodeChannels).concat(pending)
            .filter(n => !!n.local_balance)
            .reduce((sum, n) => sum + n.local_balance, Number());

          const remote = [].concat(nodeChannels).concat(pending)
            .filter(n => !!n.remote_balance)
            .reduce((sum, n) => sum + n.remote_balance, Number());

          const isDisconnected = !connected.length && !pending.length;

          const nodeIcons = getIcons.nodes.find(n => n.public_key === node.id);

          return {
            alias: node.alias,
            earned_inbound_fees: sources.reduce((sum, n) => sum + n.fee, 0),
            earned_outbound_fees: forwards.reduce((sum, n) => sum + n.fee, 0),
            icons: !!nodeIcons ? nodeIcons.icons : undefined,
            is_disconnected: isDisconnected || undefined,
            is_forwarding: hasHtlcChannel || undefined,
            is_inactive: !isDisconnected && !active.length || undefined,
            is_pending: !!pending.length || undefined,
            is_private: !!isHidden || undefined,
            last_inbound_at: !lastIn ? undefined : lastIn.toISOString(),
            last_outbound_at: !lastOut ? undefined : lastOut.toISOString(),
            liquidity_inbound: remote,
            liquidity_outbound: local,
            public_key: node.id,
          };
        });

        const sorted = peers
          .sort((a, b) => {
            if (args.sort === 'earned_in') {
              return a.earned_inbound_fees - b.earned_inbound_fees;
            }

            if (args.sort === 'earned_out') {
              return a.earned_outbound_fees - b.earned_outbound_fees;
            }

            if (args.sort === 'earned_total') {
              const aTotal = a.earned_inbound_fees + a.earned_outbound_fees;
              const bTotal = b.earned_inbound_fees + b.earned_outbound_fees;

              return aTotal - bTotal;
            }

            if (args.sort === 'inbound') {
              return a.liquidity_inbound - b.liquidity_inbound;
            }

            if (args.sort === 'liquidity') {
              const aTotal = a.liquidity_inbound + a.liquidity_outbound;
              const bTotal = b.liquidity_inbound + b.liquidity_outbound;

              return aTotal - bTotal;
            }

            if (args.sort === 'outbound') {
              return a.liquidity_outbound - b.liquidity_outbound;
            }

            const aEvents = [a.last_outbound_at, a.last_inbound_at];
            const bEvents = [b.last_outbound_at, b.last_inbound_at];

            const [lastA] = aEvents.filter(n => !!n).sort().reverse();
            const [lastB] = bEvents.filter(n => !!n).sort().reverse();

            return sort(lastA, lastB);
          })
          .filter(peer => {
            return peer.earned_inbound_fees || peer.earned_outbound_fees;
          });

        return cbk(null, {peers: sorted});
      }],

      // Final forwards table
      allForwards: ['forwards', ({forwards}, cbk) => {
        if (!args.is_table) {
          return cbk(null, {peers: forwards.peers});
        }

        const isWideSize = !size || size.get().width > wideSizeCols;

        return cbk(null, {
          peers: forwards.peers,
          rows: []
            .concat([notNull([
              'Alias',
              'Earned In',
              'Earned Out',
              'Inbound',
              'Outbound',
              !!isWideSize ? 'Public Key' : null,
            ]).map(n => !args.is_monochrome ? bold(n) : n)])
            .concat(forwards.peers.map(peer => {
              return notNull([
                chartAliasForPeer({
                  alias: peer.alias,
                  icons: peer.icons,
                  is_disconnected: peer.is_disconnected,
                  is_forwarding: peer.is_forwarding,
                  is_inactive: peer.is_inactive,
                  is_pending: peer.is_pending,
                  is_private: peer.is_private,
                  public_key: peer.public_key,
                }).display,
                formatTokens({
                  is_monochrome: args.is_monochrome,
                  tokens: peer.earned_inbound_fees
                }).display,
                formatTokens({
                  is_monochrome: args.is_monochrome,
                  tokens: peer.earned_outbound_fees,
                }).display,
                formatTokens({
                  is_monochrome: args.is_monochrome,
                  tokens: peer.liquidity_inbound,
                }).display,
                formatTokens({
                  is_monochrome: args.is_monochrome,
                  tokens: peer.liquidity_outbound,
                }).display,
                !!isWideSize ? peer.public_key : null,
              ]);
            })),
        });
      }],
    },
    returnResult({reject, resolve, of: 'allForwards'}, cbk));
  });
};
