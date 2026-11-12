const asyncAuto = require('async/auto');
const {createInvoice} = require('ln-service');
const {Metadata} = require('@grpc/grpc-js');
const {returnResult} = require('asyncjs-util');
const {status} = require('@grpc/grpc-js');

const {challengeHeader} = require('./../constants');
const {macaroonTokens} = require('./../constants');
const makeSwapMacaroon = require('./make_swap_macaroon');
const {paymentRequiredMessage} = require('./../constants');

const challenge = (mac, req) => `LSAT macaroon="${mac}", invoice="${req}"`;

/** Make a payment required challenge to purchase a swap macaroon

  {
    lnd: <Authenticated LND API Object>
  }

  @returns via cbk or Promise
  {
    error: <gRPC Payment Required Error Object>
  }
*/
module.exports = ({lnd}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedLndToMakePaymentChallenge']);
        }

        return cbk();
      },

      // Create the invoice that pays for the macaroon
      createInvoice: ['validate', ({}, cbk) => {
        return createInvoice({lnd, tokens: macaroonTokens}, cbk);
      }],

      // Make the error that carries the macaroon and the invoice
      error: ['createInvoice', ({createInvoice}, cbk) => {
        const {macaroon} = makeSwapMacaroon({hash: createInvoice.id});
        const metadata = new Metadata();
        const {request} = createInvoice;

        metadata.add(challengeHeader, challenge(macaroon, request));

        return cbk(null, {
          error: {
            metadata,
            code: status.UNAUTHENTICATED,
            details: paymentRequiredMessage,
          },
        });
      }],
    },
    returnResult({reject, resolve, of: 'error'}, cbk));
  });
};
