const {addPeer} = require('ln-service');
const asyncAuto = require('async/auto');
const asyncDetectSeries = require('async/detectSeries');
const asyncRetry = require('async/retry');
const {returnResult} = require('asyncjs-util');

const {isArray} = Array;
const peerAddedDelayMs = 1000 * 5;
const times = 10;

/** Connect to a peer given an array of sockets

  {
    id: <Node Identity Public Key Hex String>
    lnd: <Authenticated LND API Object>
    sockets: [<Peer Networking Socket String>]
  }

  @returns via cbk or Promise
*/
module.exports = ({id, lnd, sockets}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!id) {
          return cbk([400, 'ExpectedPublicKeyOfNodeToConnectTo']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndToConnectToPeer']);
        }

        if (!isArray(sockets)) {
          return cbk([400, 'ExpectedArrayOfSocketsToConnectToNode']);
        }

        return cbk();
      },

      // Connect to the peer
      connect: ['validate', ({}, cbk) => {
        return asyncRetry({times}, cbk => {
          return asyncDetectSeries(sockets, (socket, cbk) => {
            return addPeer({lnd, socket, public_key: id}, err => {
              return cbk(null, !err);
            });
          },
          (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            if (!res) {
              return cbk([503, 'FailedToConnectToPeerSocket', ({peer: id})]);
            }

            return setTimeout(() => cbk(null, true), peerAddedDelayMs);
          });
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
