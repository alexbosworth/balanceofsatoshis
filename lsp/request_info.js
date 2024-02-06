const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const {sendMessageToPeer} = require('ln-service');
const {requests}  = require('./requests.json');
const encodeMessage = n => Buffer.from(JSON.stringify(n)).toString('hex');

module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguements
      validate: cbk => {
        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToRequestInfo']);
        }

        if (!args.pubkey) {
          return cbk([400, 'ExpectedPubkeyToRequestInfo']);
        }

        if (!args.type) {
          return cbk([400, 'ExpectedTypeToRequestInfo']);
        }

        return cbk();
      },

      // Request info
      requestInfo: ['validate', ({}, cbk) => {
        const message = encodeMessage(requests.lsps1GetinfoRequest);
        console.log('message: ', message);

        return sendMessageToPeer({
          message,
          lnd: args.lnd,
          public_key: args.pubkey,
          type: args.type,
        },
        cbk);
      }],
    },
    returnResult({reject, resolve, of: 'requestInfo'}, cbk));
  });
}