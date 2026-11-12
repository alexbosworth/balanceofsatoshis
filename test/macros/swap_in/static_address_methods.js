const {getHeight} = require('ln-service');

const {authenticateSwapRequest} = require('./../service');
const createSharedAddress = require('./create_shared_address');
const {maxSwapTokens} = require('./../constants');
const {minSwapTokens} = require('./../constants');
const publishSwapInFallback = require('./publish_swap_in_fallback');
const quoteSwapIn = require('./quote_swap_in');
const requestSwapIn = require('./request_swap_in');
const settleSwapIn = require('./settle_swap_in');
const signSharedUtxosSpend = require('./sign_shared_utxos_spend');
const signSwapInFallbacks = require('./sign_swap_in_fallbacks');
const {swapInFallbackInfos} = require('./../constants');
const {withAuthentication} = require('./../service');

const bufferAsHex = buffer => Buffer.from(buffer).toString('hex');
const defaultCltvDelta = 40;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const {keys} = Object;
const reversed = buffer => Buffer.from(buffer).reverse();

/** Make the shared address swap in gRPC methods of a fake swap server

  {
    [is_failing_fallback_sigs]: <Fail to Take Fallback Signatures Bool>
    [is_publishing_fallback]: <Publish Fallback HTLC Instead of Paying Bool>
    [is_rejecting_deposits]: <Reject Deposits Instead of Paying Bool>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    network: <Network Name String>
  }

  @returns
  {
    static: {
      pushStaticAddressHtlcSigs: <Push HTLC Signatures gRPC Method Function>
      pushStaticAddressSweeplessSigs: <Push Sweep Signatures Method Function>
      serverNewAddress: <Create Shared Address gRPC Method Function>
      serverPsbtWithdrawDeposits: <Cosign Deposits Spend gRPC Method Function>
      serverStaticAddressLoopIn: <Request Swap In gRPC Method Function>
    }
    swap: {
      loopInQuote: <Quote Swap In gRPC Method Function>
      loopInTerms: <Swap In Terms gRPC Method Function>
      subscribeNotifications: <Subscribe To Notifications gRPC Method Function>
    }
  }
*/
module.exports = args => {
  const addresses = {};
  const {lnd, logger, network} = args;
  const streams = {};
  const swaps = {};

  // Send a notification to the subscription of the client that owns a swap
  const notify = (hash, notification) => {
    // Exit early when the client is not subscribed
    if (!streams[hash]) {
      return logger.error({no_client_subscription_for: notification});
    }

    return streams[hash].write(notification);
  };

  // Run a method for an authenticated request
  const authenticated = (call, cbk, method) => {
    return withAuthentication({call, cbk, lnd, logger, method});
  };

  // Create the shared address of a client, or return the existing one
  const createAddress = ({hash, request}, cbk) => {
    const key = bufferAsHex(request.client_key);

    const [existing] = addresses[hash] || [];

    // A client only has one shared address, made with one client key
    if (!!existing && existing.client_key !== key) {
      return cbk([400, 'ExpectedSameClientKeyForSharedAddress']);
    }

    // Exit early when the client already has an address
    if (!!existing) {
      return cbk(null, {
        params: {
          expiry: existing.expiry,
          server_key: hexAsBuffer(existing.server_key),
        },
      });
    }

    return getHeight({lnd}, (err, res) => {
      if (!!err) {
        return cbk(err);
      }

      return createSharedAddress({
        lnd,
        network,
        client_key: key,
        start_height: res.current_block_height,
      },
      (err, res) => {
        if (!!err) {
          return cbk(err);
        }

        addresses[hash] = [res];

        logger.info({created_shared_address: res.address});

        return cbk(null, {
          params: {
            expiry: res.expiry,
            server_key: hexAsBuffer(res.server_key),
          },
        });
      });
    });
  };

  // Request a swap in of deposits
  const create = ({hash, request}, cbk) => {
    const lastHop = request.last_hop;

    return requestSwapIn({
      lnd,
      network,
      swaps,
      addresses: addresses[hash] || [],
      hash: bufferAsHex(request.swap_hash),
      htlc_client_key: bufferAsHex(request.htlc_client_pub_key),
      incoming_peer: !lastHop.length ? undefined : bufferAsHex(lastHop),
      is_fast: request.fast,
      outpoints: request.deposit_outpoints,
      request: request.swap_invoice,
      tokens: Number(request.amount) || undefined,
      version: request.protocol_version,
    },
    (err, res) => {
      if (!!err) {
        return cbk(err);
      }

      swaps[bufferAsHex(request.swap_hash)].client = hash;

      const response = {
        htlc_expiry: res.htlc_expiry,
        htlc_server_pub_key: hexAsBuffer(res.htlc_server_key),
      };

      res.fallbacks.forEach(fallback => {
        return response[swapInFallbackInfos[fallback.type]] = {
          fee_rate: fallback.fee_tokens_per_kw.toString(),
          nonces: fallback.nonces.map(hexAsBuffer),
        };
      });

      return cbk(null, response);
    });
  };

  // Take the client signatures for the fallback HTLCs, then pay and sweep
  const pushHtlcSigs = ({hash, request}, cbk) => {
    const swap = swaps[bufferAsHex(request.swap_hash)];

    if (!swap || swap.client !== hash) {
      return cbk([400, 'ExpectedKnownSwapToPushHtlcSignatures']);
    }

    const infos = keys(swapInFallbackInfos).map(type => ({
      type,
      info: request[swapInFallbackInfos[type]],
    }));

    // Exit early when the client is canceling the swap
    if (infos.every(n => !n.info)) {
      swap.is_canceled = true;

      logger.info({canceled_swap_in: swap.hash});

      return cbk(null, {});
    }

    if (!!swap.is_signed) {
      return cbk([400, 'ExpectedUnsignedSwapToPushHtlcSignatures']);
    }

    // Exit early when failing to take the signatures, as if the push failed
    if (!!args.is_failing_fallback_sigs) {
      return cbk([503, 'FailedToTakeFallbackSignatures']);
    }

    return signSwapInFallbacks({
      lnd,
      swap,
      signatures: infos.map(({info, type}) => ({
        type,
        nonces: ((info || {}).nonces || []).map(bufferAsHex),
        sigs: ((info || {}).sigs || []).map(bufferAsHex),
      })),
    },
    (err, res) => {
      if (!!err) {
        return cbk(err);
      }

      swap.fallback_transactions = res.transactions;
      swap.is_signed = true;

      logger.info({signed_swap_in_fallbacks: res.transactions.map(n => n.id)});

      // Exit early when rejecting the deposits, releasing them for other uses
      if (!!args.is_rejecting_deposits) {
        swap.is_canceled = true;

        logger.info({rejected_swap_in_deposits: swap.hash});

        notify(hash, {
          static_loop_in_risk_rejected: {swap_hash: hexAsBuffer(swap.hash)},
        });

        return cbk(null, {});
      }

      // Exit early when taking the deposits to the fallback without paying
      if (!!args.is_publishing_fallback) {
        publishSwapInFallback({lnd, logger, swap}, err => {
          if (!!err) {
            return logger.error({swap_in_fallback_publish_failed: err});
          }

          return;
        });

        return cbk(null, {});
      }

      // Pay and sweep in the background
      settleSwapIn({
        lnd,
        logger,
        network,
        swap,
        notify: notification => notify(hash, notification),
      },
      err => {
        if (!!err) {
          return logger.error({swap_in_settlement_failed: err});
        }

        return;
      });

      return cbk(null, {});
    });
  };

  // Take the client signatures for the sweep, or a deferral
  const pushSweepSigs = ({hash, request}, cbk) => {
    const swap = swaps[bufferAsHex(request.swap_hash)];

    if (!swap || swap.client !== hash) {
      return cbk([400, 'ExpectedKnownSwapToPushSweepSignatures']);
    }

    if (!swap.sweep || swap.sweep.id !== bufferAsHex(reversed(request.txid))) {
      return cbk([400, 'ExpectedSweepTransactionIdToPushSweepSignatures']);
    }

    // Exit early when the client is deferring the sweep
    if (!!request.error_message) {
      swap.emitter.emit('deferred');

      return cbk(null, {});
    }

    const info = request.signing_info || {};

    const signatures = keys(info).reduce((sum, outpoint) => {
      sum[outpoint] = {
        nonce: bufferAsHex(info[outpoint].nonce),
        signature: bufferAsHex(info[outpoint].sig),
      };

      return sum;
    },
    {});

    swap.emitter.emit('signed', signatures);

    return cbk(null, {});
  };

  // Quote a swap in
  const quote = ({request}, cbk) => {
    const swap = {
      is_fast: request.fast,
      tokens: Number(request.amt),
      utxos_count: Number(request.num_static_address_deposits),
    };

    try {
      quoteSwapIn(swap);
    } catch (err) {
      return cbk([400, err.message]);
    }

    const {fee} = quoteSwapIn(swap);

    return cbk(null, {cltv_delta: defaultCltvDelta, swap_fee: fee});
  };

  // Cosign a spend of deposits
  const spend = ({hash, request}, cbk) => {
    const nonces = request.deposit_to_nonces || {};

    return signSharedUtxosSpend({
      lnd,
      network,
      swaps,
      addresses: addresses[hash] || [],
      nonces: keys(nonces).reduce((sum, outpoint) => {
        sum[outpoint] = bufferAsHex(nonces[outpoint]);

        return sum;
      },
      {}),
      psbt: bufferAsHex(request.withdrawal_psbt),
    },
    (err, res) => {
      if (!!err) {
        return cbk(err);
      }

      return cbk(null, {
        signing_info: res.signatures.reduce((sum, signature) => {
          sum[signature.outpoint] = {
            nonce: hexAsBuffer(signature.nonce),
            sig: hexAsBuffer(signature.signature),
          };

          return sum;
        },
        {}),
        txid: reversed(hexAsBuffer(res.id)),
      });
    });
  };

  // Subscribe to the notifications of a client
  const subscribe = call => {
    const {hash} = authenticateSwapRequest({metadata: call.metadata});

    if (!hash) {
      return call.destroy(new Error('ExpectedPaidMacaroonToSubscribe'));
    }

    streams[hash] = call;

    // A newer subscription of the client replaces the old one
    return call.on('cancelled', () => {
      if (streams[hash] !== call) {
        return;
      }

      return delete streams[hash];
    });
  };

  // Terms of swaps in
  const terms = ({}, cbk) => {
    return cbk(null, {
      max_swap_amount: maxSwapTokens,
      min_swap_amount: minSwapTokens,
    });
  };

  return {
    static: {
      pushStaticAddressHtlcSigs: (call, cbk) => {
        return authenticated(call, cbk, pushHtlcSigs);
      },
      pushStaticAddressSweeplessSigs: (call, cbk) => {
        return authenticated(call, cbk, pushSweepSigs);
      },
      serverNewAddress: (call, cbk) => {
        return authenticated(call, cbk, createAddress);
      },
      serverPsbtWithdrawDeposits: (call, cbk) => {
        return authenticated(call, cbk, spend);
      },
      serverStaticAddressLoopIn: (call, cbk) => {
        return authenticated(call, cbk, create);
      },
    },
    swap: {
      loopInQuote: (call, cbk) => authenticated(call, cbk, quote),
      loopInTerms: (call, cbk) => terms(call.request, cbk),
      subscribeNotifications: call => subscribe(call),
    },
  };
};
