const {addPeer} = require('ln-service');
const asyncAuto = require('async/auto');
const asyncDetectSeries = require('async/detectSeries');
const asyncRetry = require('async/retry');
const {getNode} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const {isArray} = Array;
const peerAddedDelayMs = 1000 * 5;
const times = 10;

/** Connect to a peer given an array of sockets

  {
    id: <Node Identity Public Key Hex String>
    lnd: <Authenticated LND API Object>
    [logger]: <Winston Logger Object>
    [retries]: <Iterations to Retry Connection Number>
    [sockets]: [<Peer Networking Socket String>]
  }

  @returns via cbk or Promise
*/
module.exports = ({id, lnd, logger, retries, sockets}, cbk) => {
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

        if (retries === 0) {
          return cbk([400, 'UnsupportedValueForConnectToPeerRetries']);
        }

        if (!!sockets && !isArray(sockets)) {
          return cbk([400, 'ExpectedArrayOfSocketsToConnectToNode']);
        }

        return cbk();
      },

      // Determine the sockets for a node
      getSockets: ['validate', ({}, cbk) => {
        if (!!sockets) {
          return cbk(null, {sockets: sockets.map(socket => ({socket}))});
        }

        return getNode({lnd, is_omitting_channels: true, public_key: id}, cbk);
      }],

      // Connect to the peer
      connect: ['getSockets', ({getSockets}, cbk) => {
        const sockets = getSockets.sockets.map(n => n.socket);

        return asyncRetry({times: retries || times}, cbk => {
          return asyncDetectSeries(sockets, (socket, cbk) => {
            if (!!logger) {
              logger.info({attempting_connection_to: socket});
            }

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

            if (!!logger) {
              return logger.info({connected_via: res});
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
