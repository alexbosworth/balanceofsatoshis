const asyncAuto = require('async/auto');
const asyncDetectSeries = require('async/detectSeries');
const {getNode} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const {isArray} = Array;

/** Get the first of a list of peers that has public channels in the graph

  A peer that is not in the graph, or that has no public channels, is not
  publicly reachable

  {
    lnd: <Authenticated LND API Object>
    peers: [<Peer Public Key Hex String>]
  }

  @returns via cbk or Promise
  {
    [public_key]: <Publicly Reachable Peer Public Key Hex String>
  }
*/
module.exports = ({lnd, peers}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToGetPublicPeer']);
        }

        if (!isArray(peers)) {
          return cbk([400, 'ExpectedArrayOfPeersToGetPublicPeer']);
        }

        return cbk();
      },

      // Look up each peer in the graph in turn until one has public channels
      getPeer: ['validate', ({}, cbk) => {
        return asyncDetectSeries(peers, (key, cbk) => {
          return getNode({
            lnd,
            is_omitting_channels: true,
            public_key: key,
          },
          (err, res) => {
            // A peer that is not in the graph is not publicly reachable
            if (!!err) {
              return cbk(null, false);
            }

            return cbk(null, !!res.channel_count);
          });
        },
        (err, key) => {
          if (!!err) {
            return cbk(err);
          }

          return cbk(null, {public_key: key});
        });
      }],
    },
    returnResult({reject, resolve, of: 'getPeer'}, cbk));
  });
};
