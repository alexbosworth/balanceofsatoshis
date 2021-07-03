const asyncAuto = require('async/auto');
const asyncFilter = require('async/filter');
const asyncMap = require('async/map');
const asyncTimeout = require('async/timeout');
const {getChannel} = require('ln-service');
const {getChannels} = require('ln-service');
const {getNode} = require('ln-service');
const {getPeers} = require('ln-service');
const {removePeer} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const connectToNodes = require('./connect_to_nodes');
const {shuffle} = require('./../arrays');

const connectLimit = 5;
const connectTimeoutMs = 1000 * 60 * 10;
const notFound = -1;
const timedOutCode = 'ETIMEDOUT';
const minimumReconnectMs = 1000 * 60 * 60 * 3;
const uniq = arr => Array.from(new Set(arr));

/** Get channel peers that are disconnected and attempt to reconnect

  This method will also disconnect peers that are connected, but have inactive
  channels.

  {
    lnd: <Authenticated LND gRPC API Object>
    [retries]: <Add Peer Retry Count Number>
  }

  @returns via cbk or Promise
  {
    reconnected: [{
      alias: <Node Alias String>
      public_key: <Node Identity Public Key Hex String
    }]
  }
*/
module.exports = ({lnd, retries}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedLndToReconnectToDisconnectedPeers']);
        }

        return cbk();
      },

      // Get open, inactive channels
      getChannels: ['validate', ({}, cbk) => getChannels({lnd}, cbk)],

      // Get connected peers
      getPeers: ['validate', ({}, cbk) => getPeers({lnd}, cbk)],

      // Get disabled but active channels
      getDisabled: ['getChannels', ({getChannels}, cbk) => {
        // Look for channels that are marked as active but have disabled policy
        const active = getChannels.channels.filter(n => !!n.is_active);

        return asyncFilter(active, (channel, cbk) => {
          return getChannel({lnd, id: channel.id}, (err, res) => {
            // Exit early when there is an issue getting a channel
            if (!!err) {
              return cbk(null, false);
            }

            const peerKey = channel.partner_public_key;

            const ownPolicy = res.policies.find(n => n.public_key !== peerKey);

            // Exit early when there is no own policy found
            if (!ownPolicy) {
              return cbk(null, false);
            }

            // Exit early when we disabled our edge out
            if (ownPolicy.is_disabled === true) {
              return cbk(null, true);
            }

            const inPolicy = res.policies.find(n => n.public_key === peerKey);

            // Exit early when there is no peer policy
            if (!inPolicy) {
              return cbk(null, false);
            }

            // Exit early when the peer disabled their edge to us
            if (inPolicy.is_disabled === true) {
              return cbk(null, true);
            }

            return cbk(null, false);
          });
        },
        cbk);
      }],

      // Disconnect connected peers that have an inactive channel
      disconnect: [
        'getChannels',
        'getDisabled',
        'getPeers',
        ({getChannels, getDisabled, getPeers}, cbk) =>
      {
        // Some peers have active channels but they are marked disabled
        const disabled = getDisabled.map(n => n.partner_public_key);

        // Only look at channels that are inactive
        const inactive = getChannels.channels.filter(n => !n.is_active);

        // Find peers that have an inactive channel but are connected peers
        const peers = getPeers.peers
          .filter(peer => {
            return !!inactive.find(channel => {
              return channel.partner_public_key === peer.public_key;
            });
          })
          .map(n => n.public_key);

        const remove = uniq([].concat(disabled).concat(peers)).filter(key => {
          const details = getPeers.peers.find(n => n.public_key === key);

          if (!details || !details.last_reconnection) {
            return true;
          }

          const lastReconnectAt = new Date(details.last_reconnection);


          return new Date() - lastReconnectAt > minimumReconnectMs;
        });

        return asyncMap(remove, (peer, cbk) => {
console.log("PEER", peer)
          return removePeer({lnd, public_key: peer}, cbk);
        },
        err => {
          if (!!err) {
            return cbk(err);
          }

          return cbk(null, remove);
        });
      }],

      // Disconnected peers
      disconnected: [
        'disconnect',
        'getChannels',
        'getPeers',
        ({disconnect, getChannels, getPeers}, cbk) =>
      {
        const connected = getPeers.peers.map(n => n.public_key);

        const disconnected = getChannels.channels
          .filter(n => !n.is_active)
          .filter(n => connected.indexOf(n.partner_public_key) === notFound)
          .map(n => n.partner_public_key)
          .concat(disconnect);

        return cbk(null, shuffle({array: uniq(disconnected)}).shuffled);
      }],

      // Get sockets for nodes
      getDisconnected: ['disconnected', ({disconnected}, cbk) => {
        return asyncMap(disconnected, (publicKey, cbk) => {
          return getNode({
            lnd,
            is_omitting_channels: true,
            public_key: publicKey,
          },
          (err, node) => {
            // Ignore errors
            if (!!err) {
              return cbk();
            }

            return cbk(null, {
              alias: node.alias,
              public_key: publicKey,
              sockets: node.sockets,
            });
          });
        },
        cbk);
      }],

      // Try to connect to all disconnected peers
      reconnect: ['getDisconnected', ({getDisconnected}, cbk) => {
        return asyncTimeout(connectToNodes, connectTimeoutMs)({
          lnd,
          retries,
          limit: connectLimit,
          nodes: getDisconnected.filter(n => !!n),
        },
        (err, res) => {
          if (!!err && err.code === timedOutCode) {
            return cbk([503, 'ReconnectingToNodesTimedOut']);
          }

          if (!!err) {
            return cbk(err);
          }

          return cbk(null, res.connected);
        });
      }],

      // Reconnected to nodes
      reconnected: [
        'getDisconnected',
        'reconnect',
        ({getDisconnected, reconnect}, cbk) =>
      {
        const offline = getDisconnected.filter(n => !!n)
          .filter(p => !reconnect.find(n => n.public_key === p.public_key))
          .filter(node => !!node.sockets.length)
          .map(node => ({alias: node.alias, public_key: node.public_key}));

        const reconnected = reconnect.map(node => ({
          alias: node.alias,
          public_key: node.public_key,
        }));

        return cbk(null, {offline, reconnected});
      }],
    },
    returnResult({reject, resolve, of: 'reconnected'}, cbk));
  });
};
