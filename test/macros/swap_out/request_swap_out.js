const asyncAuto = require('async/auto');
const asyncify = require('async/asyncify');
const {returnResult} = require('asyncjs-util');

const createSwapOut = require('./create_swap_out');
const fundSwapOut = require('./fund_swap_out');
const quoteSwapOut = require('./quote_swap_out');
const {taprootVersion} = require('./../constants');

const isHash = n => !!n && /^[0-9A-F]{64}$/i.test(n);
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);

/** Request a new swap out from the swap server

  {
    expiry: <Swap Timeout Height Number>
    hash: <Swap Hash Hex String>
    key: <Client Claim Public Key Hex String>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    network: <Network Name String>
    public_key: <Swap Server Public Key Hex String>
    swaps: <Swaps Keyed By Swap Hash Object>
    tokens: <Swap Tokens Number>
    version: <Swap Protocol Version String>
  }

  @returns via cbk or Promise
  {
    deposit_request: <Deposit Invoice BOLT 11 Request String>
    fund_request: <Funding Invoice BOLT 11 Request String>
    server_key: <Server Public Key Hex String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.expiry) {
          return cbk([400, 'ExpectedSwapExpiryHeightToRequestSwapOut']);
        }

        if (!isHash(args.hash)) {
          return cbk([400, 'ExpectedSwapHashToRequestSwapOut']);
        }

        if (!isPublicKey(args.key)) {
          return cbk([400, 'ExpectedClientClaimPublicKeyToRequestSwapOut']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToRequestSwapOut']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToRequestSwapOut']);
        }

        if (!args.network) {
          return cbk([400, 'ExpectedNetworkNameToRequestSwapOut']);
        }

        if (!args.public_key) {
          return cbk([400, 'ExpectedServerPublicKeyToRequestSwapOut']);
        }

        if (!args.swaps) {
          return cbk([400, 'ExpectedSwapsToRequestSwapOut']);
        }

        if (!!args.swaps[args.hash]) {
          return cbk([400, 'ExpectedUniqueSwapHashToRequestSwapOut']);
        }

        if (!args.tokens) {
          return cbk([400, 'ExpectedSwapTokensToRequestSwapOut']);
        }

        if (args.version !== taprootVersion) {
          return cbk([400, 'ExpectedTaprootSwapVersionToRequestSwapOut']);
        }

        return cbk();
      },

      // Price the swap
      quote: ['validate', asyncify(({}) => {
        try {
          return quoteSwapOut({
            public_key: args.public_key,
            tokens: args.tokens,
          });
        } catch (err) {
          throw [400, err.message];
        }
      })],

      // Create the swap
      create: ['quote', ({quote}, cbk) => {
        return createSwapOut({
          deposit: quote.deposit,
          expiry: args.expiry,
          fee: quote.fee,
          hash: args.hash,
          key: args.key,
          lnd: args.lnd,
          network: args.network,
          tokens: args.tokens,
        },
        cbk);
      }],

      // Register the swap and fund it on chain once its payments are held
      register: ['create', ({create}, cbk) => {
        const swap = {
          deposit_id: create.deposit_id,
          expiry: args.expiry,
          fund_payment: create.fund_payment,
          hash: args.hash,
          key: args.key,
          key_index: create.key_index,
          output_script: create.output_script,
          root_hash: create.root_hash,
          server_key: create.server_key,
          tokens: args.tokens,
        };

        args.swaps[args.hash] = swap;

        // Fund in the background, the client pays after the request returns
        fundSwapOut({
          address: create.address,
          deposit_id: create.deposit_id,
          deposit_secret: create.deposit_secret,
          hash: args.hash,
          lnd: args.lnd,
          output_script: create.output_script,
          tokens: args.tokens,
        },
        (err, res) => {
          if (!!err) {
            return args.logger.error({swap_funding_failed: err});
          }

          swap.funding = res;

          return args.logger.info({published_swap_funding: res});
        });

        return cbk();
      }],

      // Final swap request details
      swap: ['create', 'register', ({create}, cbk) => {
        return cbk(null, {
          deposit_request: create.deposit_request,
          fund_request: create.fund_request,
          server_key: create.server_key,
        });
      }],
    },
    returnResult({reject, resolve, of: 'swap'}, cbk));
  });
};
