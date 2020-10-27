const {addPeer} = require('ln-service');
const asyncAuto = require('async/auto');
const asyncDetectSeries = require('async/detectSeries');
const asyncFilterLimit = require('async/filterLimit');
const asyncMap = require('async/map');
const {getChannels} = require('ln-service');
const {getNode} = require('ln-service');
const {getPeers} = require('ln-service');
const {removePeer} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const {shuffle} = require('./../arrays');

const connectLimit = 5;
const notFound = -1;
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
      getChannels: ['validate', ({}, cbk) => {
        return getChannels({lnd, is_offline: true}, cbk);
      }],

      // Get connected peers
      getPeers: ['validate', ({}, cbk) => getPeers({lnd}, cbk)],

      // Disconnect connected peers that have an inactive channel
      disconnect: [
        'getChannels',
        'getPeers',
        ({getChannels, getPeers}, cbk) =>
      {
        // Find peers that have an inactive channel but are connected peers
        const peers = getPeers.peers.filter(peer => {
          return !!getChannels.channels.find(channel => {
            return channel.partner_public_key === peer.public_key;
          });
        });

        return asyncMap(peers, (peer, cbk) => {
          return removePeer({lnd, public_key: peer.public_key}, cbk);
        },
        err => {
          if (!!err) {
            return cbk(err);
          }

          return cbk(null, peers.map(n => n.public_key));
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
        const nodes = getDisconnected.filter(n => !!n);

        return asyncFilterLimit(nodes, connectLimit, (node, cbk) => {
          return asyncDetectSeries(node.sockets, ({socket}, cbk) => {
            return addPeer({
              lnd,
              socket,
              public_key: node.public_key,
              retry_count: retries,
            },
            err => cbk(null, !err));
          },
          cbk);
        },
        cbk);
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
