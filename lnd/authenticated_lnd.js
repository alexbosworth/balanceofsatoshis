const asyncAuto = require('async/auto');
const {authenticatedLndGrpc} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const lndCredentials = require('./lnd_credentials');

/** Authenticated LND

  {
    [node]: <Node Name String>
  }

  @returns via cbk or Promise
  {
    lnd: <Authenticated LND gRPC API Object>
  }
*/
module.exports = ({node}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Credentials
      credentials: cbk => lndCredentials({node}, cbk),

      // Lnd
      lnd: ['credentials', ({credentials}, cbk) => {
        return cbk(null, authenticatedLndGrpc({
          cert: credentials.cert,
          macaroon: credentials.macaroon,
          socket: credentials.socket,
        }));
      }],
    },
    returnResult({reject, resolve, of: 'lnd'}, cbk));
  });
};
