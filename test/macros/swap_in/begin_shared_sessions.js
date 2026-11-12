const asyncAuto = require('async/auto');
const asyncMapSeries = require('async/mapSeries');
const {beginGroupSigningSession} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const {keyFamily} = require('./../constants');

/** Begin signing sessions with the shared address key for deposits

  {
    deposits: [{
      address: {
        client_key: <Client Public Key Hex String>
        root_hash: <Shared Address Script Tree Root Hash Hex String>
        server_index: <Server Key Index Number>
        server_key: <Server Public Key Hex String>
      }
    }]
    lnd: <Authenticated LND API Object>
  }

  @returns via cbk or Promise
  {
    sessions: [{
      id: <Session Id Hex String>
      nonce: <Session Nonce Hex String>
    }]
  }
*/
module.exports = ({deposits, lnd}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!deposits) {
          return cbk([400, 'ExpectedDepositsToBeginSharedSessions']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndToBeginSharedSessions']);
        }

        return cbk();
      },

      // Begin a session for every deposit
      begin: ['validate', ({}, cbk) => {
        return asyncMapSeries(deposits, ({address}, cbk) => {
          return beginGroupSigningSession({
            lnd,
            key_family: keyFamily,
            key_index: address.server_index,
            public_keys: [address.client_key, address.server_key],
            root_hash: address.root_hash,
          },
          (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            return cbk(null, {id: res.id, nonce: res.nonce});
          });
        },
        cbk);
      }],

      // Session details
      sessions: ['begin', ({begin}, cbk) => cbk(null, {sessions: begin})],
    },
    returnResult({reject, resolve, of: 'sessions'}, cbk));
  });
};
