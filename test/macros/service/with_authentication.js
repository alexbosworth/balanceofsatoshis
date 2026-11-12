const authenticateSwapRequest = require('./authenticate_swap_request');
const {grpcCodes} = require('./../constants');
const makePaymentChallenge = require('./make_payment_challenge');

const asGrpcError = ([code, details]) => ({details, code: grpcCodes[code]});

/** Run a method for an authenticated call or challenge the call for payment

  {
    call: <gRPC Call Object>
    cbk: <gRPC Callback Function>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    method: <Method Function> ({hash, request}, cbk) => {}
  }
*/
module.exports = ({call, cbk, lnd, logger, method}) => {
  const {hash} = authenticateSwapRequest({metadata: call.metadata});

  // Exit early when the request has a paid macaroon
  if (!!hash) {
    return method({hash, request: call.request}, (err, res) => {
      if (!!err) {
        logger.error({swap_server_error: err});

        return cbk(asGrpcError(err));
      }

      return cbk(null, res);
    });
  }

  return makePaymentChallenge({lnd}, (err, res) => {
    if (!!err) {
      return cbk(asGrpcError(err));
    }

    return cbk(res.error);
  });
};
