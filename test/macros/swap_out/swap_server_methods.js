const cancelSwapOut = require('./cancel_swap_out');
const {maxCltvDelta} = require('./../constants');
const {maxSwapTokens} = require('./../constants');
const {minCltvDelta} = require('./../constants');
const {minSwapTokens} = require('./../constants');
const pushSwapOutPreimage = require('./push_swap_out_preimage');
const quoteSwapOut = require('./quote_swap_out');
const requestSwapOut = require('./request_swap_out');
const signSwapOutSweep = require('./sign_swap_out_sweep');
const {withAuthentication} = require('./../service');

const bufferAsHex = buffer => Buffer.from(buffer).toString('hex');
const hexAsBuffer = hex => Buffer.from(hex, 'hex');

/** Make the swap out gRPC methods of a fake swap server

  {
    [is_uncooperative]: <Refuse to Cosign Sweeps Bool>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    network: <Network Name String>
    public_key: <Swap Server Public Key Hex String>
  }

  @returns
  {
    cancelLoopOutSwap: <Cancel Swap Out gRPC Method Function>
    loopOutPushPreimage: <Push Swap Out Preimage gRPC Method Function>
    loopOutQuote: <Quote Swap Out gRPC Method Function>
    loopOutTerms: <Swap Out Terms gRPC Method Function>
    muSig2SignSweep: <Cosign Swap Out Sweep gRPC Method Function>
    newLoopOutSwap: <Request Swap Out gRPC Method Function>
  }
*/
module.exports = args => {
  const swaps = {};

  // Run a method for a request with a paid macaroon, or challenge for one
  const authenticated = (call, cbk, method) => {
    return withAuthentication({
      call,
      cbk,
      method,
      lnd: args.lnd,
      logger: args.logger,
    });
  };

  // Cancel a swap that is not funded yet
  const cancel = ({request}, cbk) => {
    return cancelSwapOut({
      swaps,
      hash: bufferAsHex(request.swap_hash),
      lnd: args.lnd,
      payment: bufferAsHex(request.payment_address),
    },
    err => cbk(err, {}));
  };

  // Cosign the sweep of a swap
  const cosign = ({request}, cbk) => {
    const swap = swaps[bufferAsHex(request.swap_hash)];

    if (!swap) {
      return cbk([400, 'ExpectedKnownSwapToCosignSwapOutSweep']);
    }

    if (swap.fund_payment !== bufferAsHex(request.payment_address)) {
      return cbk([400, 'ExpectedSwapPaymentIdentifierToCosignSweep']);
    }

    // The funding payment has to be taken before the sweep is cosigned
    if (!swap.is_settled) {
      return cbk([400, 'ExpectedSettledSwapToCosignSwapOutSweep']);
    }

    // Exit early when the server does not cooperate with sweeps
    if (!!args.is_uncooperative) {
      return cbk([503, 'RefusedToCosignSwapOutSweep']);
    }

    return signSwapOutSweep({
      key: swap.key,
      key_index: swap.key_index,
      lnd: args.lnd,
      nonce: bufferAsHex(request.nonce),
      output_script: swap.output_script,
      psbt: bufferAsHex(request.sweep_tx_psbt),
      root_hash: swap.root_hash,
      server_key: swap.server_key,
      tokens: swap.tokens,
      transaction_id: swap.funding.transaction_id,
      transaction_vout: swap.funding.transaction_vout,
    },
    (err, res) => {
      if (!!err) {
        return cbk(err);
      }

      return cbk(null, {
        nonce: hexAsBuffer(res.nonce),
        partial_signature: hexAsBuffer(res.partial_signature),
      });
    });
  };

  // Request a new swap
  const create = ({request}, cbk) => {
    return requestSwapOut({
      swaps,
      expiry: request.expiry,
      hash: bufferAsHex(request.swap_hash),
      key: bufferAsHex(request.receiver_key),
      lnd: args.lnd,
      logger: args.logger,
      network: args.network,
      public_key: args.public_key,
      tokens: Number(request.amt),
      version: request.protocol_version,
    },
    (err, res) => {
      if (!!err) {
        return cbk(err);
      }

      return cbk(null, {
        prepay_invoice: res.deposit_request,
        sender_key: hexAsBuffer(res.server_key),
        swap_invoice: res.fund_request,
      });
    });
  };

  // Take the funding payment of a swap with its preimage
  const push = ({request}, cbk) => {
    return pushSwapOutPreimage({
      swaps,
      lnd: args.lnd,
      preimage: bufferAsHex(request.preimage),
    },
    err => cbk(err, {}));
  };

  // Quote the cost of a swap
  const quote = ({request}, cbk) => {
    const swap = {public_key: args.public_key, tokens: Number(request.amt)};

    try {
      quoteSwapOut(swap);
    } catch (err) {
      return cbk([400, err.message]);
    }

    const pricing = quoteSwapOut(swap);

    return cbk(null, {
      prepay_amt: pricing.deposit,
      swap_fee: pricing.fee,
      swap_payment_dest: pricing.destination,
    });
  };

  // Terms of the swap service, which need no paid macaroon
  const terms = (call, cbk) => {
    return cbk(null, {
      max_cltv_delta: maxCltvDelta,
      max_swap_amount: maxSwapTokens,
      min_cltv_delta: minCltvDelta,
      min_swap_amount: minSwapTokens,
    });
  };

  return {
    cancelLoopOutSwap: (call, cbk) => authenticated(call, cbk, cancel),
    loopOutPushPreimage: (call, cbk) => authenticated(call, cbk, push),
    loopOutQuote: (call, cbk) => authenticated(call, cbk, quote),
    loopOutTerms: (call, cbk) => terms(call, cbk),
    muSig2SignSweep: (call, cbk) => authenticated(call, cbk, cosign),
    newLoopOutSwap: (call, cbk) => authenticated(call, cbk, create),
  };
};
