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

const byLastForwardAt = (a, b) => parse(a.last_forward_at) < parse(b.last_forward_at) ? -1 : 1;
const limit = 99999;
const {max} = Math;
const {min} = Math;
const msPerDay = 1000 * 60 * 60 * 24;
const {now} = Date;
const numDays = 1;
const {parse} = Date;

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
      forward_fees: <Forward Fees Number>
      last_forward_at: <Last Forward At ISO 8601 Date String>
      outbound_liquidity: <Outbound Liquidity Tokens Number>
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
    nodes: ['lnd', 'sendingToPeers', ({lnd, sendingToPeers}, cbk) => {
      return asyncMap(uniq(sendingToPeers), (publicKey, cbk) => {
        return getNode({lnd, public_key: publicKey}, (err, node) => {
          if (!!err) {
            return cbk(err);
          }

          return cbk(null, {alias: node.alias, public_key: publicKey});
        });
      },
      cbk);
    }],

    // Closed channels
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

        const forwardTimes = forwards.map(n => parse(n.created_at));

        const pending = getPending.pending_channels
          .filter(n => n.is_opening)
          .filter(n => n.partner_public_key === node.public_key);

        const local = [].concat(channels).concat(pending)
          .reduce((sum, n) => sum + n.local_balance, 0);

        const remote = [].concat(channels).concat(pending)
          .reduce((sum, n) => sum + n.remote_balance, 0);

        const lastClose = min(...closes.map(n => n.blocks_since_close));

        return {
          alias: node.alias,
          blocks_since_last_close: !closes.length ? undefined : lastClose,
          forward_fees: forwards.reduce((sum, n) => sum + n.fee, 0),
          last_forward_at: new Date(max(...forwardTimes)).toISOString(),
          outbound_liquidity: local,
          public_key: node.public_key,
        };
      });

      peers.sort(byLastForwardAt);

      return cbk(null, peers);
    }],
  },
  returnResult({of: 'forwards'}, cbk));
};
