const asyncAuto = require('async/auto');
const {getChannels} = require('ln-service');
const {getPeers} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const getPublicPeer = require('./get_public_peer');
const {sortBy} = require('./../arrays');

const isMessagesBit = n => onionMessagesBits.includes(n.bit);
const isRelay = peer => peer.features.some(isMessagesBit);
const onionMessagesBits = [38, 39];
const uniq = arr => Array.from(new Set(arr));

/** Get the peer to start the path of a new support offer at

  A node with a public channel starts the offer path at itself. A node that is
  connected only by private channels starts it at a publicly reachable peer,
  as BOLT 12 requires, so that payers can reach the offer.

  That peer has an active channel with the node, relays onion messages, and
  has public channels. The peer with the largest channel is picked.

  {
    lnd: <Authenticated LND API Object>
  }

  @returns via cbk or Promise
  {
    [introduction]: <Introduction Peer Public Key Hex String>
  }
*/
module.exports = ({lnd}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToGetOfferIntroduction']);
        }

        return cbk();
      },

      // Get the channels of the node to see if it has a public channel
      getChannels: ['validate', ({}, cbk) => getChannels({lnd}, cbk)],

      // Get the connected peers to see which of them relay onion messages
      getPeers: ['getChannels', ({getChannels}, cbk) => {
        // Exit early when the node has a public channel
        if (getChannels.channels.some(n => !n.is_private)) {
          return cbk();
        }

        return getPeers({lnd}, cbk);
      }],

      // Peers that relay onion messages over active channels, largest first
      candidates: [
        'getChannels',
        'getPeers',
        ({getChannels, getPeers}, cbk) =>
      {
        // Exit early when the node has a public channel
        if (!getPeers) {
          return cbk(null, []);
        }

        const relays = getPeers.peers.filter(isRelay).map(n => n.public_key);

        const channels = getChannels.channels
          .filter(n => n.is_active)
          .filter(n => relays.includes(n.partner_public_key));

        const {sorted} = sortBy({array: channels, attribute: 'capacity'});

        const largestFirst = sorted.slice().reverse();

        return cbk(null, uniq(largestFirst.map(n => n.partner_public_key)));
      }],

      // Find the first candidate that is publicly reachable
      getPublicPeer: ['candidates', ({candidates}, cbk) => {
        return getPublicPeer({lnd, peers: candidates}, cbk);
      }],

      // The peer to start the offer path at, when the node is private
      introduction: [
        'getPeers',
        'getPublicPeer',
        ({getPeers, getPublicPeer}, cbk) =>
      {
        // Exit early when the node has a public channel to start the path at
        if (!getPeers) {
          return cbk(null, {});
        }

        // Exit early when no peer can start the offer path of a private node
        if (!getPublicPeer.public_key) {
          return cbk([503, 'ExpectedPublicPeerToStartPrivateNodeOfferPath']);
        }

        return cbk(null, {introduction: getPublicPeer.public_key});
      }],
    },
    returnResult({reject, resolve, of: 'introduction'}, cbk));
  });
};
