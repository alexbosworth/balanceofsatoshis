const EventEmitter = require('node:events');

const asyncAuto = require('async/auto');
const asyncify = require('async/asyncify');
const asyncMapSeries = require('async/mapSeries');
const {getHeight} = require('ln-service');
const {getPublicKey} = require('ln-service');
const {parsePaymentRequest} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {swapScriptV2} = require('goldengate');

const beginSharedSessions = require('./begin_shared_sessions');
const findSharedDeposits = require('./find_shared_deposits');
const {keyFamily} = require('./../constants');
const quoteSwapIn = require('./quote_swap_in');
const {sharedAddressProtocolVersion} = require('./../constants');
const {swapInFallbackFeeRates} = require('./../constants');
const {swapInHtlcCltvDelta} = require('./../constants');

const dustTokens = 330;
const flatten = arr => [].concat(...arr);
const isActive = swap => !swap.is_canceled && !swap.is_swept;
const isHash = n => !!n && /^[0-9A-F]{64}$/i.test(n);
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const {keys} = Object;
const outpoint = n => `${n.transaction_id}:${n.transaction_vout}`;
const singleAddress = 1;
const sumOf = arr => arr.reduce((sum, n) => sum + n, Number());
const uniq = arr => Array.from(new Set(arr));

/** Request a swap in of deposits to a shared address

  {
    addresses: [<Client Shared Address Object>]
    hash: <Swap Hash Hex String>
    htlc_client_key: <Client HTLC Refund Public Key Hex String>
    [incoming_peer]: <Pay In Through Peer Public Key Hex String>
    [is_fast]: <Swap Is Requested Fast Bool>
    lnd: <Authenticated LND API Object>
    network: <Network Name String>
    outpoints: [<Deposit Outpoint String>]
    request: <Swap Invoice BOLT 11 Request String>
    swaps: <Swaps In Keyed By Swap Hash Object>
    [tokens]: <Swap Tokens Number>
    version: <Shared Address Protocol Version String>
  }

  @returns via cbk or Promise
  {
    fallbacks: [{
      fee_tokens_per_kw: <Fallback Fee Tokens Per Thousand Weight Number>
      nonces: [<Server Session Nonce Hex String>]
      type: <Fallback Type String>
    }]
    htlc_expiry: <HTLC Timeout Height Number>
    htlc_server_key: <Server HTLC Public Key Hex String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.addresses || !args.addresses.length) {
          return cbk([400, 'ExpectedClientSharedAddressesToRequestSwapIn']);
        }

        if (!isHash(args.hash)) {
          return cbk([400, 'ExpectedSwapHashToRequestSwapIn']);
        }

        if (!isPublicKey(args.htlc_client_key)) {
          return cbk([400, 'ExpectedClientHtlcKeyToRequestSwapIn']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToRequestSwapIn']);
        }

        if (!args.network) {
          return cbk([400, 'ExpectedNetworkNameToRequestSwapIn']);
        }

        if (!args.outpoints || !args.outpoints.length) {
          return cbk([400, 'ExpectedDepositOutpointsToRequestSwapIn']);
        }

        if (!args.request) {
          return cbk([400, 'ExpectedSwapInvoiceToRequestSwapIn']);
        }

        if (!args.swaps) {
          return cbk([400, 'ExpectedSwapsToRequestSwapIn']);
        }

        if (!!args.swaps[args.hash]) {
          return cbk([400, 'ExpectedUniqueSwapHashToRequestSwapIn']);
        }

        if (args.version !== sharedAddressProtocolVersion) {
          return cbk([400, 'ExpectedSharedAddressVersionToRequestSwapIn']);
        }

        return cbk();
      },

      // Decode the swap invoice
      invoice: ['validate', asyncify(({}) => {
        try {
          return parsePaymentRequest({request: args.request});
        } catch (err) {
          throw [400, 'ExpectedValidSwapInvoiceToRequestSwapIn'];
        }
      })],

      // Find the deposits of the client
      findDeposits: ['validate', ({}, cbk) => {
        return findSharedDeposits({
          addresses: args.addresses,
          lnd: args.lnd,
          network: args.network,
          outpoints: args.outpoints,
        },
        cbk);
      }],

      // Check the deposits are from one address and not in another swap
      checkDeposits: ['findDeposits', ({findDeposits}, cbk) => {
        const {deposits} = findDeposits;

        const addresses = uniq(deposits.map(n => n.address.address));

        if (addresses.length !== singleAddress) {
          return cbk([400, 'ExpectedDepositsToOneSharedAddressForSwapIn']);
        }

        const swaps = keys(args.swaps).map(hash => args.swaps[hash]);

        // Deposits are locked to a swap until the swap is canceled or swept
        const active = swaps.filter(isActive);

        const locked = flatten(active.map(n => n.deposits.map(outpoint)));

        if (deposits.some(n => locked.includes(outpoint(n)))) {
          return cbk([400, 'ExpectedUnusedDepositsForSwapIn']);
        }

        return cbk();
      }],

      // Swap amounts
      amounts: [
        'checkDeposits',
        'findDeposits',
        'invoice',
        ({findDeposits, invoice}, cbk) =>
      {
        const total = sumOf(findDeposits.deposits.map(n => n.tokens));

        const tokens = args.tokens || total;

        const change = total - tokens;

        if (change < 0) {
          return cbk([400, 'ExpectedDepositsToCoverSwapInAmount']);
        }

        if (!!change && change < dustTokens) {
          return cbk([400, 'ExpectedNonDustChangeForSwapIn']);
        }

        // Fast publication is only allowed when there is a change output
        if (!!args.is_fast && !change) {
          return cbk([400, 'ExpectedChangeOutputForFastSwapIn']);
        }

        const {fee} = quoteSwapIn({
          tokens,
          is_fast: args.is_fast,
          utxos_count: findDeposits.deposits.length,
        });

        if (invoice.tokens !== tokens - fee) {
          return cbk([400, 'ExpectedSwapInvoiceForSwapTokensLessFee']);
        }

        return cbk(null, {change, fee, tokens});
      }],

      // Get the current height for the HTLC timeout
      getHeight: ['amounts', ({}, cbk) => getHeight({lnd: args.lnd}, cbk)],

      // Get the server key for the HTLC
      getHtlcKey: ['amounts', ({}, cbk) => {
        return getPublicKey({family: keyFamily, lnd: args.lnd}, cbk);
      }],

      // Derive the HTLC script
      htlc: ['getHeight', 'getHtlcKey', ({getHeight, getHtlcKey}, cbk) => {
        const expiry = getHeight.current_block_height + swapInHtlcCltvDelta;

        const {script} = swapScriptV2({
          claim_public_key: getHtlcKey.public_key,
          hash: args.hash,
          refund_public_key: args.htlc_client_key,
          timeout: expiry,
        });

        return cbk(null, {expiry, script, key: getHtlcKey.public_key});
      }],

      // Begin signing sessions for the fallback HTLC transactions
      fallbacks: ['findDeposits', 'htlc', ({findDeposits}, cbk) => {
        return asyncMapSeries(keys(swapInFallbackFeeRates), (type, cbk) => {
          return beginSharedSessions({
            deposits: findDeposits.deposits,
            lnd: args.lnd,
          },
          (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            return cbk(null, {
              type,
              fee_tokens_per_kw: swapInFallbackFeeRates[type],
              sessions: res.sessions,
            });
          });
        },
        cbk);
      }],

      // Register the swap
      register: [
        'amounts',
        'fallbacks',
        'findDeposits',
        'htlc',
        ({amounts, fallbacks, findDeposits, htlc}, cbk) =>
      {
        args.swaps[args.hash] = {
          fallbacks,
          htlc,
          change: amounts.change,
          deposits: findDeposits.deposits,
          emitter: new EventEmitter(),
          fee: amounts.fee,
          hash: args.hash,
          incoming_peer: args.incoming_peer,
          request: args.request,
          tokens: amounts.tokens,
        };

        return cbk();
      }],

      // Swap request details
      swap: ['fallbacks', 'htlc', 'register', ({fallbacks, htlc}, cbk) => {
        return cbk(null, {
          fallbacks: fallbacks.map(fallback => ({
            fee_tokens_per_kw: fallback.fee_tokens_per_kw,
            nonces: fallback.sessions.map(n => n.nonce),
            type: fallback.type,
          })),
          htlc_expiry: htlc.expiry,
          htlc_server_key: htlc.key,
        });
      }],
    },
    returnResult({reject, resolve, of: 'swap'}, cbk));
  });
};
