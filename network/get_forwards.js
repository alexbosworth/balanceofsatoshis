const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {authenticatedLndGrpc} = require('ln-service');
const {getChannels} = require('ln-service');
const {getClosedChannels} = require('ln-service');
const {getForwards} = require('ln-service');
const {getPendingChannels} = require('ln-service');
const {getNode} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {uniq} = require('lodash');

const {lndCredentials} = require('./../lnd');

const lastTime = times => !times.length ? null : new Date(max(...times));
const limit = 99999;
const {max} = Math;
const {min} = Math;
const msPerDay = 1000 * 60 * 60 * 24;
const {now} = Date;
const numDays = 1;
const {parse} = Date;
const tokensAsBigTokens = tokens => (tokens / 1e8).toFixed(8);

/** Get recent forwarding activity

  {
    [days]: <Days Number>
    [node]: <Node Name String>
  }

  @returns via cbk
  {
    peers: [{
      alias: <Peer Alias String>
      [blocks_since_last_close]: <Blocks Since Last Closed Channel Number>
      earned_inbound_fees: <Earned Inbound Fee Tokens Number>
      earned_outbound_fees: <Earned Outbound Fee Tokens Number>
      last_inbound_at: <Last Inbound Forward At ISO 8601 Date String>
      last_outbound_at: <Last Forward At ISO 8601 Date String>
      liquidity_inbound: <Inbound LIquidity Big Tokens String>
      outbound_liquidity: <Outbound Liquidity Big Tokens String>
      public_key: <Public Key String>
    }]
  }
*/
module.exports = ({days, node}, cbk) => {
  return asyncAuto({
    // Credentials
    credentials: cbk => lndCredentials({node}, cbk),

    // Lnd
    lnd: ['credentials', ({credentials}, cbk) => {
      return cbk(null, authenticatedLndGrpc({
        cert: credentials.cert,
        macaroon: credentials.macaroon,
        socket: credentials.socket,
      }).lnd);
    }],

    // Get channels
    getChannels: ['lnd', ({lnd}, cbk) => getChannels({lnd}, cbk)],

    // Get closed channels
    getClosed: ['lnd', ({lnd}, cbk) => getClosedChannels({lnd}, cbk)],

    // Get forwards
    getForwards: ['lnd', ({lnd}, cbk) => {
      const after = new Date(now() - (days || numDays)*msPerDay).toISOString();
      const before = new Date().toISOString();

      return getForwards({after, before, lnd, limit}, cbk);
    }],

    // Get current block height
    getHeight: ['lnd', ({lnd}, cbk) => getWalletInfo({lnd}, cbk)],

    // Get pending channels
    getPending: ['lnd', ({lnd}, cbk) => getPendingChannels({lnd}, cbk)],

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
      'lnd',
      'sendingFromPeers',
      'sendingToPeers',
      ({lnd, sendingFromPeers, sendingToPeers}, cbk) =>
    {
      const nodes = uniq([].concat(sendingFromPeers).concat(sendingToPeers));

      return asyncMap(nodes, (publicKey, cbk) => {
        return getNode({
          lnd,
          is_omitting_channels: true,
          public_key: publicKey
        },
        (err, node) => {
          if (!!err) {
            return cbk(err);
          }

          return cbk(null, {alias: node.alias, public_key: publicKey});
        });
      },
      cbk);
    }],

    closedChans: ['getClosed', 'getHeight', ({getClosed, getHeight}, cbk) => {
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
        const channels = getChannels.channels
          .filter(n => n.partner_public_key === node.public_key);

        const closes = closedChans.filter(n => {
          return n.partner_public_key === node.public_key;
        });

        const forwards = getForwards.forwards.filter(n => {
          return !!channels.find(({id}) => n.outgoing_channel === id);
        });

        const sources = getForwards.forwards.filter(n => {
          return !!channels.find(({id}) => n.incoming_channel === id);
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
          blocks_since_last_close: !closes.length ? undefined : lastClose,
          earned_inbound_fees: sources.reduce((sum, n) => sum + n.fee, 0),
          earned_outbound_fees: forwards.reduce((sum, n) => sum + n.fee, 0),
          last_inbound_at: !lastIn ? undefined : lastIn.toISOString(),
          last_outbound_at: !lastOut ? undefined : lastOut.toISOString(),
          liquidity_inbound: tokensAsBigTokens(remote),
          liquidity_outbound: tokensAsBigTokens(local),
          public_key: node.public_key,
        };
      });

      peers.sort((a, b) => {
        const [lastA] = [a.last_outbound_at, a.last_inbound_at].sort();
        const [lastB] = [b.last_outbound_at, b.last_inbound_at].sort();

        return lastA < lastB ? -1 : 1;
      });

      return cbk(null, {peers});
    }],
  },
  returnResult({of: 'forwards'}, cbk));
};
