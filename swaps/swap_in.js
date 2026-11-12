const EventEmitter = require('events');

const {addressForScript} = require('goldengate');
const asyncAuto = require('async/auto');
const asyncify = require('async/asyncify');
const asyncReflect = require('async/reflect');
const {broadcastChainTransaction} = require('ln-service');
const {createInvoice} = require('ln-service');
const {createSharedAddress} = require('goldengate');
const {createSwapIn} = require('goldengate');
const {getChainFeeRate} = require('ln-service');
const {getHeight} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {getPublicKey} = require('ln-service');
const {getSharedUtxos} = require('goldengate');
const {getSwapInQuote} = require('goldengate');
const {getSwapInTerms} = require('goldengate');
const moment = require('moment');
const qrcode = require('qrcode-terminal');
const {returnResult} = require('asyncjs-util');
const {sharedAddressScript} = require('goldengate');
const {signSharedUtxosRefund} = require('goldengate');
const {signSwapInCoopSettlement} = require('goldengate');
const {signSwapInFallbackRefund} = require('goldengate');
const {signSwapInServiceFallback} = require('goldengate');
const {subscribeToBlocks} = require('ln-service');
const {subscribeToChainSpend} = require('ln-service');
const {swapScriptV2} = require('goldengate');

const cancelUnsignedSwapIn = require('./cancel_unsigned_swap_in');
const decodeSwapInRecovery = require('./decode_swap_in_recovery');
const {encodeAsCbor} = require('./../encryption');
const encodeSwapInRecovery = require('./encode_swap_in_recovery');
const {formatFeeRate} = require('./../display');
const getPaidService = require('./get_paid_service');
const {sharedAddressKeyFamily} = require('./constants');
const subscribeToSwapIn = require('./subscribe_to_swap_in');
const {swapInCosignQuietMs} = require('./constants');
const {swapInDepositConfs} = require('./constants');
const {swapInMaxTimeoutBlocks} = require('./constants');
const {swapInPaymentTimeoutSeconds} = require('./constants');
const {swapInRefundConfTarget} = require('./constants');
const {swapInSweepRequestsWaitMs} = require('./constants');
const {swapInUtxosCount} = require('./constants');
const waitForSwapInPayment = require('./wait_for_swap_in_payment');

const base64AsBuffer = base64 => Buffer.from(base64, 'base64');
const bigFormat = tokens => ((tokens || 0) / 1e8).toFixed(8);
const confirmations = (height, utxo) => height - utxo.confirmation_height + 1;
const depositUrl = (address, tokens) => `bitcoin:${address}?amount=${tokens}`;
const exitCodeSigint = 130;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const httpMatch = /^https?:\/\//;
const interruptSignal = 'SIGINT';
const isLimit = n => Number.isSafeInteger(n) && n > 0;
const isReorg = err => Array.isArray(err) && err[0] === 409;
const msPerYear = 1000 * 60 * 60 * 24 * 365;
const {now} = Date;
const outpoint = n => `${n.transaction_id}:${n.transaction_vout}`;
const ppm = (fee, tokens) => Math.ceil(fee / tokens * 1e6);
const refundHeight = (expiry, utxo) => utxo.confirmation_height + expiry;
const sumOf = arr => arr.reduce((sum, n) => sum + n, Number());

/** Receive funds on-chain through a shared address swap in

  {
    [api_key]: <API Key CBOR Hex String>
    fetch: <Fetch Function>
    [in_through]: <Request Inbound Payment Public Key Hex String>
    lnd: <Authenticated LND gRPC API Object>
    logger: <Logger Object>
    [max_api_key_fee]: <Maximum Tokens to Pay for a Service API Key Number>
    max_fee: <Maximum Fee Tokens to Pay Number>
    [max_fee_rate]: <Maximum Fee Rate Parts Per Million Number>
    [recovery]: <Reuse Shared Address Recovery Hex String>
    [refund_address]: <Refund Expired Deposits, Unpaid Swaps to Address String>
    [socket]: <Swap Socket String>
    tokens: <Tokens Number>
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.fetch) {
          return cbk([400, 'ExpectedFetchFunctionToReceiveOnChain']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToReceiveOnChain']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToReceiveOnChain']);
        }

        if (args.max_fee === undefined) {
          return cbk([400, 'ExpectedMaxFeeToReceiveOnChain']);
        }

        if (!isLimit(args.max_fee)) {
          return cbk([400, 'ExpectedMaxFeeAboveZeroToReceiveOnChain']);
        }

        if (args.max_fee_rate !== undefined && !isLimit(args.max_fee_rate)) {
          return cbk([400, 'ExpectedMaxFeeRateAboveZeroToReceiveOnChain']);
        }

        if (!!args.refund_address && !args.recovery) {
          return cbk([400, 'ExpectedRecoveryOfAddressToRefundDeposits']);
        }

        // A web service socket is for services without shared addresses
        if (!!args.socket && httpMatch.test(args.socket)) {
          return cbk([400, 'ExpectedHostAndPortSocketToReceiveOnChain']);
        }

        if (!args.tokens) {
          return cbk([400, 'ExpectedTokensAmountToReceiveOnChain']);
        }

        return cbk();
      },

      // Get the current chain height
      getHeight: ['validate', ({}, cbk) => getHeight({lnd: args.lnd}, cbk)],

      // Get the network this swap takes place on
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd: args.lnd}, cbk)],

      // Decode the recovery details of an existing shared address
      recover: ['validate', asyncify(() => {
        // Exit early when there is no existing shared address
        if (!args.recovery) {
          return;
        }

        try {
          return decodeSwapInRecovery({recovery: args.recovery});
        } catch (err) {
          throw [400, 'FailedToDecodeSwapInRecoveryDetails', {err}];
        }
      })],

      // The service ties the shared address to the recovery service token
      token: ['recover', ({recover}, cbk) => {
        // Exit early when there is no existing shared address
        if (!recover) {
          return cbk(null, args.api_key);
        }

        const {cbor} = encodeAsCbor({
          value: {
            macaroon: base64AsBuffer(recover.macaroon),
            preimage: hexAsBuffer(recover.preimage),
          },
        });

        return cbk(null, cbor);
      }],

      // Upgrade service object to a paid service if necessary
      getService: ['token', ({token}, cbk) => {
        // Exit early when refunding, which does not use the service
        if (!!args.refund_address) {
          return cbk();
        }

        return getPaidService({
          token,
          fetch: args.fetch,
          lnd: args.lnd,
          max_fee: args.max_api_key_fee,
          socket: args.socket,
        },
        cbk);
      }],

      // Report the purchase of a service API key
      purchase: ['getService', ({getService}, cbk) => {
        // Exit early when no API key was purchased
        if (!getService || !getService.paid || !getService.token) {
          return cbk();
        }

        args.logger.info({
          amount_paid_for_api_key: bigFormat(getService.paid),
          service_api_key: getService.token,
        });

        return cbk();
      }],

      // Get the client key of the shared address
      getKey: ['recover', ({recover}, cbk) => {
        return getPublicKey({
          family: sharedAddressKeyFamily,
          index: !recover ? undefined : recover.index,
          lnd: args.lnd,
        },
        cbk);
      }],

      // Create a shared address with the service
      createAddress: [
        'getKey',
        'getNetwork',
        'getService',
        'recover',
        ({getKey, getNetwork, getService, recover}, cbk) =>
      {
        // Exit early when the shared address already exists
        if (!!recover) {
          return cbk(null, {
            expiry: recover.expiry,
            service_public_key: recover.service_public_key,
          });
        }

        return createSharedAddress({
          metadata: getService.metadata,
          network: getNetwork.network,
          public_key: getKey.public_key,
          service: getService.service,
        },
        cbk);
      }],

      // Derive the shared address details
      address: [
        'createAddress',
        'getKey',
        'getNetwork',
        asyncify(({createAddress, getKey, getNetwork}) =>
      {
        try {
          return sharedAddressScript({
            client_public_key: getKey.public_key,
            expiry: createAddress.expiry,
            network: getNetwork.network,
            server_public_key: createAddress.service_public_key,
          });
        } catch (err) {
          throw [503, 'FailedToDeriveSharedAddressForSwapIn', {err}];
        }
      })],

      // Shared address details to save to swap in again or refund deposits
      recovery: [
        'createAddress',
        'getHeight',
        'getKey',
        'getService',
        'recover',
        asyncify(({createAddress, getHeight, getKey, getService, recover}) =>
      {
        // Exit early when refunding, the recovery is already known
        if (!!args.refund_address) {
          return {recovery: args.recovery};
        }

        const height = !recover ? getHeight.current_block_height : undefined;

        return encodeSwapInRecovery({
          expiry: createAddress.expiry,
          index: getKey.index,
          macaroon: getService.macaroon,
          preimage: getService.preimage,
          service_public_key: createAddress.service_public_key,
          start_height: height || recover.start_height,
        });
      })],

      // Get the limits for a swap
      getLimits: ['getService', ({getService}, cbk) => {
        // Exit early when refunding
        if (!!args.refund_address) {
          return cbk();
        }

        return getSwapInTerms({
          metadata: getService.metadata,
          service: getService.service,
        },
        cbk);
      }],

      // Estimate the swap fee for the amount
      getEstimate: [
        'getLimits',
        'getService',
        ({getLimits, getService}, cbk) =>
      {
        // Exit early when refunding
        if (!!args.refund_address) {
          return cbk();
        }

        if (args.tokens > getLimits.max_tokens) {
          return cbk([400, 'SwapSizeTooLarge', {max: getLimits.max_tokens}]);
        }

        if (args.tokens < getLimits.min_tokens) {
          return cbk([400, 'SwapSizeTooSmall', {min: getLimits.min_tokens}]);
        }

        return getSwapInQuote({
          metadata: getService.metadata,
          service: getService.service,
          tokens: args.tokens,
          utxos_count: swapInUtxosCount,
        },
        cbk);
      }],

      // Show the address to deposit to
      showAddress: [
        'address',
        'createAddress',
        'getEstimate',
        'purchase',
        'recovery',
        ({address, createAddress, getEstimate, recovery}, cbk) =>
      {
        // Exit early when refunding
        if (!!args.refund_address) {
          return cbk();
        }

        if (getEstimate.fee > args.max_fee) {
          return cbk([400, 'MaxFeeExceededForSwap', {fee: getEstimate.fee}]);
        }

        const rate = ppm(getEstimate.fee, args.tokens);
        const url = depositUrl(address.address, bigFormat(args.tokens));

        if (!!args.max_fee_rate && rate > args.max_fee_rate) {
          return cbk([400, 'MaxFeeRateExceededForSwap', {fee_rate: rate}]);
        }

        return qrcode.generate(url, {small: true}, qr => {
          args.logger.info({
            swap: {
              send_to_address: address.address,
              send_exact_amount: bigFormat(args.tokens),
              send_to_qr: qr,
            },
            estimated_swap_fee: bigFormat(getEstimate.fee),
            estimated_swap_fee_rate: formatFeeRate({rate}).display,
            recovery_secret: recovery.recovery,
            timing: {
              refund_available: `${createAddress.expiry} blocks after deposit`,
            },
          });

          return cbk();
        });
      }],

      // Subscribe to swap status notifications from the service
      subscribe: ['getService', 'showAddress', ({getService}, cbk) => {
        // Exit early when refunding
        if (!!args.refund_address) {
          return cbk();
        }

        const notifications = {accepted: [], rejected: [], sweeps: []};
        const updates = new EventEmitter();

        const sub = subscribeToSwapIn({
          metadata: getService.metadata,
          service: getService.service,
        });

        sub.on('coop_settlement', sweep => {
          notifications.sweeps.push(sweep);

          return updates.emit('update');
        });

        sub.on('error', err => args.logger.error({swap_status_error: err}));

        // The service has a deadline to pay once it accepts the deposits
        sub.on('risk_accepted', ({id}) => {
          notifications.accepted.push({id, at: now()});

          return updates.emit('update');
        });

        sub.on('risk_rejected', ({id}) => {
          notifications.rejected.push(id);

          return updates.emit('update');
        });

        return cbk(null, {notifications, sub, updates});
      }],

      // Find confirmed deposits to the shared address
      findDeposits: [
        'address',
        'createAddress',
        'getHeight',
        'getNetwork',
        'recover',
        'showAddress',
        ({address, createAddress, getHeight, getNetwork, recover}, cbk) =>
      {
        const scan = {noted: []};
        const sub = subscribeToBlocks({lnd: args.lnd});

        const start = !recover ? getHeight.current_block_height : undefined;

        const startHeight = start || recover.start_height;

        const finished = (err, res) => {
          // Exit early when the deposits search already finished
          if (!!scan.is_finished) {
            return;
          }

          scan.is_finished = true;

          sub.removeAllListeners();

          return cbk(err, res);
        };

        // Look for deposits in the blocks that were not scanned yet
        const scanDeposits = height => {
          // Exit early when a scan is in progress, the next block will scan
          if (!!scan.is_scanning) {
            return;
          }

          scan.is_scanning = true;

          return getSharedUtxos({
            address: address.address,
            id: scan.id,
            lnd: args.lnd,
            min_height: !scan.id ? startHeight : scan.height + 1,
            network: getNetwork.network,
            utxos: scan.utxos,
          },
          (err, res) => {
            scan.is_scanning = false;

            // Exit early when scanned blocks were reorganized, scan again
            if (isReorg(err)) {
              scan.height = undefined;
              scan.id = undefined;
              scan.utxos = undefined;

              return scanDeposits(height);
            }

            if (!!err) {
              return finished(err);
            }

            scan.height = res.height;
            scan.id = res.id;
            scan.utxos = res.utxos;

            const confirmed = res.utxos.filter(utxo => {
              return confirmations(height, utxo) >= swapInDepositConfs;
            });

            const pending = res.utxos.filter(n => !confirmed.includes(n));

            // Exit early when refunding, every deposit is relevant
            if (!!args.refund_address) {
              return finished(null, {height, utxos: res.utxos});
            }

            // Deposits of other amounts are left for another swap or refund
            const deposit = confirmed.find(n => n.tokens === args.tokens);

            // Exit early when a deposit of the exact amount is confirmed
            if (!!deposit) {
              return finished(null, {height, utxos: [deposit]});
            }

            // Deposits of other amounts stay at the address, note them once
            const others = confirmed.filter(utxo => {
              return !scan.noted.includes(outpoint(utxo));
            });

            const notes = others.map(utxo => ({
              amount: bigFormat(utxo.tokens),
              outpoint: outpoint(utxo),
              refund_from_block: refundHeight(createAddress.expiry, utxo),
              swap_in_with: `swap-in ${utxo.tokens} --recovery`,
            }));

            notes.forEach(n => scan.noted.push(n.outpoint));

            notes.forEach(n => args.logger.info({deposit_not_swapped: n}));

            if (!!pending.length) {
              args.logger.info({
                waiting_for_deposit_confirmations: pending.map(outpoint),
              });
            }

            return;
          });
        };

        sub.on('block', ({height}) => scanDeposits(height));

        sub.on('error', err => finished([503, 'BlockSubscribeFailed', {err}]));

        return scanDeposits(getHeight.current_block_height);
      }],

      // Get the refund key of the fallback HTLC of a swap
      getFallbackKey: ['recover', ({recover}, cbk) => {
        // Exit early when there is no fallback HTLC to refund
        if (!args.refund_address || !recover.htlc_hash) {
          return cbk();
        }

        return getPublicKey({
          family: sharedAddressKeyFamily,
          index: recover.htlc_index,
          lnd: args.lnd,
        },
        cbk);
      }],

      // Derive the address of the fallback HTLC of a swap
      fallback: [
        'getFallbackKey',
        'getNetwork',
        'recover',
        asyncify(({getFallbackKey, getNetwork, recover}) =>
      {
        // Exit early when there is no fallback HTLC to refund
        if (!getFallbackKey) {
          return;
        }

        try {
          const {script} = swapScriptV2({
            claim_public_key: recover.htlc_service_public_key,
            hash: recover.htlc_hash,
            refund_public_key: getFallbackKey.public_key,
            timeout: recover.htlc_timeout,
          });

          return addressForScript({script, network: getNetwork.network});
        } catch (err) {
          throw [400, 'FailedToDeriveSwapFallbackToRefund', {err}];
        }
      })],

      // Find the funds that the service moved to the fallback HTLC
      findFallback: [
        'fallback',
        'getNetwork',
        'recover',
        ({fallback, getNetwork, recover}, cbk) =>
      {
        // Exit early when there is no fallback HTLC to refund
        if (!fallback) {
          return cbk();
        }

        return getSharedUtxos({
          address: fallback.address,
          lnd: args.lnd,
          min_height: recover.htlc_start_height,
          network: getNetwork.network,
        },
        cbk);
      }],

      // Get the chain fee rate to refund at
      getRefundFeeRate: ['validate', ({}, cbk) => {
        // Exit early when not refunding
        if (!args.refund_address) {
          return cbk();
        }

        return getChainFeeRate({
          confirmation_target: swapInRefundConfTarget,
          lnd: args.lnd,
        },
        cbk);
      }],

      // Find the funds that can be refunded now
      refundable: [
        'createAddress',
        'findDeposits',
        'findFallback',
        'recover',
        ({createAddress, findDeposits, findFallback, recover}, cbk) =>
      {
        // Exit early when not refunding
        if (!args.refund_address) {
          return cbk();
        }

        const {expiry} = createAddress;
        const fallbacks = !findFallback ? [] : findFallback.utxos;
        const {height} = findDeposits;

        const expired = findDeposits.utxos.filter(utxo => {
          return refundHeight(expiry, utxo) <= height;
        });

        // Fallback HTLC funds can be refunded once the HTLC times out
        const isTimedOut = height >= recover.htlc_timeout;

        const htlcs = isTimedOut ? fallbacks : [];

        if (!expired.length && !htlcs.length) {
          const heights = findDeposits.utxos.map(n => refundHeight(expiry, n));

          const timeouts = fallbacks.map(() => recover.htlc_timeout);

          return cbk([400, 'ExpectedExpiredDepositsToRefund', {
            current_height: height,
            refund_heights: heights.concat(timeouts),
          }]);
        }

        return cbk(null, {expired, htlcs});
      }],

      // Refund expired deposits to the refund address
      refund: [
        'createAddress',
        'getKey',
        'getNetwork',
        'getRefundFeeRate',
        'refundable',
        ({
          createAddress,
          getKey,
          getNetwork,
          getRefundFeeRate,
          refundable,
        },
        cbk) =>
      {
        // Exit early when there are no expired deposits to refund
        if (!refundable || !refundable.expired.length) {
          return cbk();
        }

        return signSharedUtxosRefund({
          expiry: createAddress.expiry,
          fee_tokens_per_vbyte: getRefundFeeRate.tokens_per_vbyte,
          key_family: sharedAddressKeyFamily,
          key_index: getKey.index,
          lnd: args.lnd,
          network: getNetwork.network,
          service_public_key: createAddress.service_public_key,
          sweep_address: args.refund_address,
          utxos: refundable.expired,
        },
        cbk);
      }],

      // Broadcast the refund transaction
      broadcastRefund: ['refund', ({refund}, cbk) => {
        // Exit early when not refunding
        if (!refund) {
          return cbk();
        }

        return broadcastChainTransaction({
          lnd: args.lnd,
          transaction: refund.transaction,
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          args.logger.info({refund_transaction_id: res.id});

          return cbk();
        });
      }],

      // Refund the funds of an unpaid swap from its timed out fallback HTLC
      refundFallback: [
        'getNetwork',
        'getRefundFeeRate',
        'recover',
        'refundable',
        ({getNetwork, getRefundFeeRate, recover, refundable}, cbk) =>
      {
        // Exit early when there are no fallback HTLC funds to refund
        if (!refundable || !refundable.htlcs.length) {
          return cbk();
        }

        return signSwapInFallbackRefund({
          fee_tokens_per_vbyte: getRefundFeeRate.tokens_per_vbyte,
          hash: recover.htlc_hash,
          key_family: sharedAddressKeyFamily,
          key_index: recover.htlc_index,
          lnd: args.lnd,
          network: getNetwork.network,
          service_public_key: recover.htlc_service_public_key,
          sweep_address: args.refund_address,
          timeout: recover.htlc_timeout,
          utxos: refundable.htlcs,
        },
        cbk);
      }],

      // Broadcast the refund of the funds of an unpaid swap
      broadcastFallbackRefund: ['refundFallback', ({refundFallback}, cbk) => {
        // Exit early when there is no unpaid swap refund
        if (!refundFallback) {
          return cbk();
        }

        return broadcastChainTransaction({
          lnd: args.lnd,
          transaction: refundFallback.transaction,
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          args.logger.info({swap_refund_transaction_id: res.id});

          return cbk();
        });
      }],

      // Get the quote for swapping in the deposits
      getQuote: [
        'findDeposits',
        'getService',
        ({findDeposits, getService}, cbk) =>
      {
        // Exit early when refunding
        if (!!args.refund_address) {
          return cbk();
        }

        return getSwapInQuote({
          metadata: getService.metadata,
          service: getService.service,
          tokens: sumOf(findDeposits.utxos.map(n => n.tokens)),
          utxos_count: findDeposits.utxos.length,
        },
        cbk);
      }],

      // Create the invoice that is paid by the swap
      createInvoice: [
        'findDeposits',
        'getQuote',
        ({findDeposits, getQuote}, cbk) =>
      {
        // Exit early when refunding
        if (!!args.refund_address) {
          return cbk();
        }

        const {fee} = getQuote;
        const total = sumOf(findDeposits.utxos.map(n => n.tokens));

        if (fee > args.max_fee) {
          return cbk([400, 'MaxFeeExceededForSwap', {required_fee: fee}]);
        }

        const rate = ppm(fee, total);

        if (!!args.max_fee_rate && rate > args.max_fee_rate) {
          return cbk([400, 'MaxFeeRateExceededForSwap', {
            required_fee_rate: rate,
          }]);
        }

        return createInvoice({
          description: `Swap in. Service fee: ${fee}`,
          expires_at: new Date(now() + msPerYear).toISOString(),
          is_including_private_channels: true,
          lnd: args.lnd,
          tokens: total - fee,
        },
        cbk);
      }],

      // Get a key for the HTLC that the service can fall back to
      getHtlcKey: ['createInvoice', ({}, cbk) => {
        // Exit early when refunding
        if (!!args.refund_address) {
          return cbk();
        }

        return getPublicKey({
          family: sharedAddressKeyFamily,
          lnd: args.lnd,
        },
        cbk);
      }],

      // Create the swap
      createSwap: [
        'createInvoice',
        'findDeposits',
        'getHtlcKey',
        'getQuote',
        'getService',
        'subscribe',
        ({
          createInvoice,
          findDeposits,
          getHtlcKey,
          getQuote,
          getService,
        },
        cbk) =>
      {
        // Exit early when refunding
        if (!!args.refund_address) {
          return cbk();
        }

        return createSwapIn({
          fee: getQuote.fee,
          in_through: args.in_through,
          max_timeout_height: findDeposits.height + swapInMaxTimeoutBlocks,
          metadata: getService.metadata,
          payment_timeout_seconds: swapInPaymentTimeoutSeconds,
          public_key: getHtlcKey.public_key,
          request: createInvoice.request,
          service: getService.service,
          utxos: findDeposits.utxos,
        },
        cbk);
      }],

      // Ctrl-C cancels the swap until its fallback is signed
      interrupt: [
        'createSwap',
        'getService',
        ({createSwap, getService}, cbk) =>
      {
        // Exit early when refunding
        if (!!args.refund_address) {
          return cbk();
        }

        // Cancel the swap and its invoice, releasing its deposits
        const cancel = cbk => cancelUnsignedSwapIn({
          id: createSwap.id,
          lnd: args.lnd,
          logger: args.logger,
          metadata: getService.metadata,
          service: getService.service,
        },
        () => cbk());

        // A second Ctrl-C exits without waiting for the swap to be canceled
        const exit = () => cancel(() => process.exit(exitCodeSigint));

        process.once(interruptSignal, exit);

        return cbk(null, {cancel, exit});
      }],

      // Recovery details that can also refund the swap if it is not paid
      swapRecovery: [
        'createSwap',
        'findDeposits',
        'getHtlcKey',
        'interrupt',
        'recovery',
        asyncReflect(asyncify(({
          createSwap,
          findDeposits,
          getHtlcKey,
          recovery,
        }) =>
      {
        // Exit early when refunding
        if (!!args.refund_address) {
          return;
        }

        try {
          const shared = decodeSwapInRecovery({recovery: recovery.recovery});

          return encodeSwapInRecovery({
            expiry: shared.expiry,
            htlc_hash: createSwap.id,
            htlc_index: getHtlcKey.index,
            htlc_service_public_key: createSwap.service_public_key,
            htlc_start_height: findDeposits.height,
            htlc_timeout: createSwap.timeout,
            index: shared.index,
            macaroon: shared.macaroon,
            preimage: shared.preimage,
            service_public_key: shared.service_public_key,
            start_height: shared.start_height,
          });
        } catch (err) {
          throw [500, 'FailedToEncodeSwapInRecoveryWithFallback', {err}];
        }
      }))],

      // Show the recovery that refunds the swap before signing its fallback
      showSwapRecovery: [
        'createSwap',
        'swapRecovery',
        ({createSwap, swapRecovery}, cbk) =>
      {
        // Exit early when refunding or when the swap recovery failed
        if (!swapRecovery.value) {
          return cbk();
        }

        args.logger.info({
          swap_recovery: {
            recovery_secret: swapRecovery.value.recovery,
            refund_if_unpaid: `After block ${createSwap.timeout}`,
          },
        });

        return cbk();
      }],

      // Sign the fallback HTLC transactions the service can publish
      signFallback: [
        'address',
        'createAddress',
        'createSwap',
        'findDeposits',
        'getKey',
        'getNetwork',
        'getService',
        'showSwapRecovery',
        'swapRecovery',
        asyncReflect(({
          address,
          createAddress,
          createSwap,
          findDeposits,
          getKey,
          getNetwork,
          getService,
          swapRecovery,
        },
        cbk) =>
      {
        // Exit early when refunding
        if (!!args.refund_address) {
          return cbk();
        }

        // Exit early when the swap recovery failed, the swap gets canceled
        if (!!swapRecovery.error) {
          return cbk();
        }

        return signSwapInServiceFallback({
          expiry: createAddress.expiry,
          fallbacks: createSwap.fallbacks,
          id: createSwap.id,
          key_family: sharedAddressKeyFamily,
          key_index: getKey.index,
          lnd: args.lnd,
          metadata: getService.metadata,
          network: getNetwork.network,
          script: createSwap.script,
          service: getService.service,
          service_public_key: createAddress.service_public_key,
          tokens: createSwap.tokens,
          utxos: findDeposits.utxos,
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          args.logger.info({swap_id: createSwap.id});

          return cbk();
        });
      })],

      // The swap is canceled when its fallback could not be signed
      signed: [
        'interrupt',
        'signFallback',
        'subscribe',
        'swapRecovery',
        ({interrupt, signFallback, subscribe, swapRecovery}, cbk) =>
      {
        // Exit early when refunding
        if (!interrupt) {
          return cbk();
        }

        // Ctrl-C no longer cancels the swap once it is signed or failed
        process.removeListener(interruptSignal, interrupt.exit);

        const error = swapRecovery.error || signFallback.error;

        // Exit early when the fallback of the swap is signed
        if (!error) {
          return cbk();
        }

        // Status updates are not needed for a canceled swap
        subscribe.sub.removeAllListeners();

        // Cancel the swap, then pass back the error that stopped it
        return interrupt.cancel(() => cbk(error));
      }],

      // Wait for the service to pay for the swap
      waitForPayment: [
        'createSwap',
        'getService',
        'signed',
        'subscribe',
        ({createSwap, getService, subscribe}, cbk) =>
      {
        // Exit early when refunding
        if (!!args.refund_address) {
          return cbk();
        }

        return waitForSwapInPayment({
          id: createSwap.id,
          lnd: args.lnd,
          logger: args.logger,
          metadata: getService.metadata,
          notifications: subscribe.notifications,
          payment_timeout_seconds: swapInPaymentTimeoutSeconds,
          service: getService.service,
          timeout: createSwap.timeout,
          updates: subscribe.updates,
        },
        (err, res) => {
          // Exit early when the swap failed, status updates are not needed
          if (!!err) {
            subscribe.sub.removeAllListeners();

            return cbk(err);
          }

          args.logger.info({
            swap_funds_received: bigFormat(res.received),
            keep_running: 'Cooperative signing reduces blockchain space use',
          });

          return cbk(null, res);
        });
      }],

      // Cosign the sweeps of the deposit until the service stops asking
      cosignSweeps: [
        'address',
        'createAddress',
        'createSwap',
        'findDeposits',
        'getKey',
        'getNetwork',
        'getService',
        'subscribe',
        'waitForPayment',
        ({
          address,
          createAddress,
          createSwap,
          findDeposits,
          getKey,
          getNetwork,
          getService,
          subscribe,
          waitForPayment,
        },
        cbk) =>
      {
        // Exit early when refunding
        if (!!args.refund_address) {
          return cbk();
        }

        const {deferred} = waitForPayment;
        const [utxo] = findDeposits.utxos;
        const signing = {pending: Number(), requests: []};
        const timers = {};

        args.logger.info({
          cosigning_sweeps: 'Waiting for cooperative signing request',
        });

        const sub = subscribeToChainSpend({
          lnd: args.lnd,
          min_height: utxo.confirmation_height,
          output_script: address.output_script,
          transaction_id: utxo.transaction_id,
          transaction_vout: utxo.transaction_vout,
        });

        const finished = (err, res) => {
          // Exit early when cosigning already finished
          if (!!signing.is_finished) {
            return;
          }

          signing.is_finished = true;

          clearTimeout(timers.wait);

          subscribe.sub.removeAllListeners();
          subscribe.updates.removeAllListeners();
          sub.removeAllListeners();

          return cbk(err, res);
        };

        // The service sweeps on its own with the cosigned sweeps
        const waitForRequests = ms => {
          clearTimeout(timers.wait);

          timers.wait = setTimeout(() => finished(), ms);
        };

        // Cosign every settlement request that has not been cosigned yet
        const cosign = () => {
          const sweeps = subscribe.notifications.sweeps.filter(sweep => {
            return sweep.id === createSwap.id && !deferred.includes(sweep);
          });

          const requests = sweeps.filter(sweep => {
            return !signing.requests.includes(sweep.psbt);
          });

          // Exit early when there are no new requests to cosign
          if (!requests.length) {
            return;
          }

          requests.forEach(sweep => signing.requests.push(sweep.psbt));

          signing.pending += requests.length;

          // Requests are not expected to stop while cosigning is in progress
          clearTimeout(timers.wait);

          return requests.forEach(sweep => {
            return signSwapInCoopSettlement({
              expiry: createAddress.expiry,
              id: sweep.id,
              key_family: sharedAddressKeyFamily,
              key_index: getKey.index,
              lnd: args.lnd,
              metadata: getService.metadata,
              network: getNetwork.network,
              nonces: sweep.nonces,
              prevouts: sweep.prevouts,
              psbt: sweep.psbt,
              service: getService.service,
              service_public_key: createAddress.service_public_key,
              swaps: [{
                id: createSwap.id,
                tokens: createSwap.tokens,
                utxos: findDeposits.utxos,
              }],
            },
            err => {
              signing.pending--;

              // Wait for more requests after the last request is cosigned
              if (!signing.pending && !signing.is_finished) {
                waitForRequests(swapInCosignQuietMs);
              }

              if (!!err) {
                return args.logger.error({cosign_sweep_error: err});
              }

              return;
            });
          });
        };

        // Exit early when the deposit is swept, cosigning is no longer needed
        sub.on('confirmation', () => finished());

        sub.on('error', err => finished([503, 'SpendSubscribeFailed', {err}]));

        subscribe.updates.on('update', cosign);

        waitForRequests(swapInSweepRequestsWaitMs);

        return cosign();
      }],

      // Finished
      summary: [
        'broadcastFallbackRefund',
        'broadcastRefund',
        'cosignSweeps',
        'createSwap',
        'waitForPayment',
        ({createSwap, waitForPayment}, cbk) =>
      {
        // Exit early when refunding
        if (!!args.refund_address) {
          return cbk();
        }

        const fee = createSwap.tokens - waitForPayment.received;

        const rate = ppm(fee, createSwap.tokens);

        args.logger.info({
          swap_successful: {
            completed: moment().calendar(),
            received_offchain: bigFormat(waitForPayment.received),
            swap_fee_paid: bigFormat(fee),
            swap_fee_rate: formatFeeRate({rate}).display,
          },
        });

        return cbk();
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
