const asyncAuto = require('async/auto');
const asyncMapSeries = require('async/mapSeries');
const {endGroupSigningSession} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {updateGroupSigningSession} = require('ln-service');

/** Finish signing sessions with the partial signatures of the client

  {
    inputs: [{
      hash: <Hash To Sign Hex String>
      id: <Server Session Id Hex String>
      nonce: <Client Nonce Hex String>
      signature: <Client Partial Signature Hex String>
    }]
    lnd: <Authenticated LND API Object>
  }

  @returns via cbk or Promise
  {
    signatures: [<Combined Signature Hex String>]
  }
*/
module.exports = ({inputs, lnd}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!inputs) {
          return cbk([400, 'ExpectedInputsToFinishSharedSessions']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndToFinishSharedSessions']);
        }

        return cbk();
      },

      // Sign with the server key and combine with the client signature
      sign: ['validate', ({}, cbk) => {
        return asyncMapSeries(inputs, (input, cbk) => {
          return updateGroupSigningSession({
            lnd,
            hash: input.hash,
            id: input.id,
            nonces: [input.nonce],
          },
          err => {
            if (!!err) {
              return cbk(err);
            }

            return endGroupSigningSession({
              lnd,
              id: input.id,
              signatures: [input.signature],
            },
            (err, res) => {
              if (!!err) {
                return cbk(err);
              }

              return cbk(null, res.signature);
            });
          });
        },
        cbk);
      }],

      // Combined signatures
      signatures: ['sign', ({sign}, cbk) => cbk(null, {signatures: sign})],
    },
    returnResult({reject, resolve, of: 'signatures'}, cbk));
  });
};
