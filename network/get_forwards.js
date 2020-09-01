const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {authenticatedLndGrpc} = require('ln-service');
const {bold} = require('colorette');
const {getChannels} = require('ln-service');
const {getClosedChannels} = require('ln-service');
const {getForwards} = require('ln-service');
const {getPendingChannels} = require('ln-service');
const {getNode} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const size = require('window-size');

const {formatTokens} = require('./../display');
const isRelevantForward = require('./is_relevant_forward');
const isRelevantSource = require('./is_relevant_source');
const {lndCredentials} = require('./../lnd');

const isEmoji = /(?:[\u261D\u26F9\u270A-\u270D]|\uD83C[\uDF85\uDFC2-\uDFC4\uDFC7\uDFCA-\uDFCC]|\uD83D[\uDC42\uDC43\uDC46-\uDC50\uDC66-\uDC69\uDC6E\uDC70-\uDC78\uDC7C\uDC81-\uDC83\uDC85-\uDC87\uDCAA\uDD74\uDD75\uDD7A\uDD90\uDD95\uDD96\uDE45-\uDE47\uDE4B-\uDE4F\uDEA3\uDEB4-\uDEB6\uDEC0\uDECC]|\uD83E[\uDD18-\uDD1C\uDD1E\uDD1F\uDD26\uDD30-\uDD39\uDD3D\uDD3E\uDDD1-\uDDDD])(?:\uD83C[\uDFFB-\uDFFF])?|(?:[\u231A\u231B\u23E9-\u23EC\u23F0\u23F3\u25FD\u25FE\u2614\u2615\u2648-\u2653\u267F\u2693\u26A1\u26AA\u26AB\u26BD\u26BE\u26C4\u26C5\u26CE\u26D4\u26EA\u26F2\u26F3\u26F5\u26FA\u26FD\u2705\u270A\u270B\u2728\u274C\u274E\u2753-\u2755\u2757\u2795-\u2797\u27B0\u27BF\u2B1B\u2B1C\u2B50\u2B55]|\uD83C[\uDC04\uDCCF\uDD8E\uDD91-\uDD9A\uDDE6-\uDDFF\uDE01\uDE1A\uDE2F\uDE32-\uDE36\uDE38-\uDE3A\uDE50\uDE51\uDF00-\uDF20\uDF2D-\uDF35\uDF37-\uDF7C\uDF7E-\uDF93\uDFA0-\uDFCA\uDFCF-\uDFD3\uDFE0-\uDFF0\uDFF4\uDFF8-\uDFFF]|\uD83D[\uDC00-\uDC3E\uDC40\uDC42-\uDCFC\uDCFF-\uDD3D\uDD4B-\uDD4E\uDD50-\uDD67\uDD7A\uDD95\uDD96\uDDA4\uDDFB-\uDE4F\uDE80-\uDEC5\uDECC\uDED0-\uDED2\uDEEB\uDEEC\uDEF4-\uDEF8]|\uD83E[\uDD10-\uDD3A\uDD3C-\uDD3E\uDD40-\uDD45\uDD47-\uDD4C\uDD50-\uDD6B\uDD80-\uDD97\uDDC0\uDDD0-\uDDE6])|(?:[#\*0-9\xA9\xAE\u203C\u2049\u2122\u2139\u2194-\u2199\u21A9\u21AA\u231A\u231B\u2328\u23CF\u23E9-\u23F3\u23F8-\u23FA\u24C2\u25AA\u25AB\u25B6\u25C0\u25FB-\u25FE\u2600-\u2604\u260E\u2611\u2614\u2615\u2618\u261D\u2620\u2622\u2623\u2626\u262A\u262E\u262F\u2638-\u263A\u2640\u2642\u2648-\u2653\u2660\u2663\u2665\u2666\u2668\u267B\u267F\u2692-\u2697\u2699\u269B\u269C\u26A0\u26A1\u26AA\u26AB\u26B0\u26B1\u26BD\u26BE\u26C4\u26C5\u26C8\u26CE\u26CF\u26D1\u26D3\u26D4\u26E9\u26EA\u26F0-\u26F5\u26F7-\u26FA\u26FD\u2702\u2705\u2708-\u270D\u270F\u2712\u2714\u2716\u271D\u2721\u2728\u2733\u2734\u2744\u2747\u274C\u274E\u2753-\u2755\u2757\u2763\u2764\u2795-\u2797\u27A1\u27B0\u27BF\u2934\u2935\u2B05-\u2B07\u2B1B\u2B1C\u2B50\u2B55\u3030\u303D\u3297\u3299]|\uD83C[\uDC04\uDCCF\uDD70\uDD71\uDD7E\uDD7F\uDD8E\uDD91-\uDD9A\uDDE6-\uDDFF\uDE01\uDE02\uDE1A\uDE2F\uDE32-\uDE3A\uDE50\uDE51\uDF00-\uDF21\uDF24-\uDF93\uDF96\uDF97\uDF99-\uDF9B\uDF9E-\uDFF0\uDFF3-\uDFF5\uDFF7-\uDFFF]|\uD83D[\uDC00-\uDCFD\uDCFF-\uDD3D\uDD49-\uDD4E\uDD50-\uDD67\uDD6F\uDD70\uDD73-\uDD7A\uDD87\uDD8A-\uDD8D\uDD90\uDD95\uDD96\uDDA4\uDDA5\uDDA8\uDDB1\uDDB2\uDDBC\uDDC2-\uDDC4\uDDD1-\uDDD3\uDDDC-\uDDDE\uDDE1\uDDE3\uDDE8\uDDEF\uDDF3\uDDFA-\uDE4F\uDE80-\uDEC5\uDECB-\uDED2\uDEE0-\uDEE5\uDEE9\uDEEB\uDEEC\uDEF0\uDEF3-\uDEF8]|\uD83E[\uDD10-\uDD3A\uDD3C-\uDD3E\uDD40-\uDD45\uDD47-\uDD4C\uDD50-\uDD6B\uDD80-\uDD97\uDDC0\uDDD0-\uDDE6])\uFE0F/g;
const lastTime = times => !times.length ? null : new Date(max(...times));
const limit = 99999;
const {max} = Math;
const {min} = Math;
const msPerDay = 1000 * 60 * 60 * 24;
const notNull = array => array.filter(n => n !== null);
const {now} = Date;
const numDays = 1;
const {parse} = Date;
const shortKey = key => key.substring(0, 16);
const sort = (a, b) => a > b ? 1 : ((b > a) ? -1 : 0);
const tokensAsBigTokens = tokens => !!tokens ? (tokens / 1e8).toFixed(8) : '';
const uniq = arr => Array.from(new Set(arr));
const wideSizeCols = 155;

/** Get recent forwarding activity

  {
    [days]: <Days Number>
    [is_monochrome]: <Mute Colors Bool>
    [is_table]: <Return Results As Table Bool>
    lnd: <Authenticated LND gRPC API Object>
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
        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToGetForwardingInformation']);
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
      getHeight: ['validate', ({}, cbk) => {
        return getWalletInfo({lnd: args.lnd}, cbk);
      }],

      // Get pending channels
      getPending: ['validate', ({}, cbk) => {
        return getPendingChannels({lnd: args.lnd}, cbk);
      }],

      // Forwards from peers
      sendingFromPeers: [
        'getChannels',
        'getForwards',
        ({getChannels, getForwards}, cbk) =>
      {
        const forwardingChannels = getChannels.channels.filter(({id}) => {
          return !!getForwards.forwards.find(n => n.incoming_channel === id);
        });

        return cbk(null, forwardingChannels.map(n => n.partner_public_key));
      }],

      // Forwards to peers
      sendingToPeers: [
        'getChannels',
        'getForwards',
        ({getChannels, getForwards}, cbk) =>
      {
        const forwardingChannels = getChannels.channels.filter(({id}) => {
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

        return asyncMap(nodes, (publicKey, cbk) => {
          return getNode({
            is_omitting_channels: true,
            lnd: args.lnd,
            public_key: publicKey
          },
          (err, node) => {
            if (!!err) {
              return cbk(null, {alias: '', public_key: publicKey});
            }

            return cbk(null, {alias: node.alias, public_key: publicKey});
          });
        },
        cbk);
      }],

      closedChans: [
        'getClosed',
        'getHeight',
        ({getClosed, getHeight}, cbk) =>
      {
        const currentHeight = getHeight.current_block_height;

        return cbk(null, getClosed.channels.map(channel => {
          return {
            blocks_since_close: currentHeight - channel.close_confirm_height,
            partner_public_key: channel.partner_public_key,
          };
        }));
      }],

      // Forwards
      forwards: [
        'closedChans',
        'getChannels',
        'getForwards',
        'getPending',
        'nodes',
        ({closedChans, getChannels, getForwards, getPending, nodes}, cbk) =>
      {
        const peers = nodes.map(node => {
          // Get the channels that are associated with this peer
          const channels = getChannels.channels
            .filter(n => n.partner_public_key === node.public_key);

          const closes = closedChans.filter(n => {
            return n.partner_public_key === node.public_key;
          });

          const forwards = getForwards.forwards.filter(forward => {
            return isRelevantForward({
              all_channels: getChannels.channels,
              from: args.from,
              incoming_channel: forward.incoming_channel,
              node_channels: channels,
              outgoing_channel: forward.outgoing_channel,
              to: args.to,
            });
          });

          const sources = getForwards.forwards.filter(forward => {
            return isRelevantSource({
              all_channels: getChannels.channels,
              from: args.from,
              incoming_channel: forward.incoming_channel,
              node_channels: channels,
              outgoing_channel: forward.outgoing_channel,
              to: args.to,
            });
          });

          const forwardTimes = forwards.map(n => parse(n.created_at));
          const inboundTimes = sources.map(n => parse(n.created_at));

          const pending = getPending.pending_channels
            .filter(n => n.is_opening)
            .filter(n => n.partner_public_key === node.public_key);

          const local = [].concat(channels).concat(pending)
            .reduce((sum, n) => sum + n.local_balance, 0);

          const remote = [].concat(channels).concat(pending)
            .reduce((sum, n) => sum + n.remote_balance, 0);

          const lastClose = min(...closes.map(n => n.blocks_since_close));

          const lastOut = lastTime(forwardTimes);
          const lastIn = lastTime(inboundTimes);

          return {
            alias: node.alias,
            earned_inbound_fees: sources.reduce((sum, n) => sum + n.fee, 0),
            earned_outbound_fees: forwards.reduce((sum, n) => sum + n.fee, 0),
            last_inbound_at: !lastIn ? undefined : lastIn.toISOString(),
            last_outbound_at: !lastOut ? undefined : lastOut.toISOString(),
            liquidity_inbound: remote,
            liquidity_outbound: local,
            public_key: node.public_key,
          };
        });

        const sorted = peers
          .sort((a, b) => {
            const aEvents = [a.last_outbound_at, a.last_inbound_at];
            const bEvents = [b.last_outbound_at, b.last_inbound_at];

            const [lastA] = aEvents.filter(n => !!n).sort().reverse();
            const [lastB] = bEvents.filter(n => !!n).sort().reverse();

            return sort(lastA, lastB);
          })
          .filter(peer => peer.earned_inbound_fees || peer.earned_outbound_fees);

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
                peer.alias.replace(isEmoji, '') || shortKey(peer.public_key),
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
