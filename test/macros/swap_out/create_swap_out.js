const {createHash} = require('node:crypto');
const {randomBytes} = require('node:crypto');

const asyncAuto = require('async/auto');
const asyncify = require('async/asyncify');
const {beginGroupSigningSession} = require('ln-service');
const {createHodlInvoice} = require('ln-service');
const {encodeBech32Address} = require('@alexbosworth/blockchain');
const {endGroupSigningSession} = require('ln-service');
const {getPublicKey} = require('ln-service');
const {hashForTree} = require('p2tr');
const {parsePaymentRequest} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {swapScriptBranches} = require('goldengate');

const {bech32Prefixes} = require('./../constants');
const {keyFamily} = require('./../constants');

const bufferAsHex = buffer => buffer.toString('hex');
const depositDescription = 'prepay';
const fundingDescription = 'swap';
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const outputScriptForKey = key => `5120${key}`;
const secretByteLength = 32;
const sha256 = preimage => createHash('sha256').update(preimage).digest('hex');
const witnessVersionTaproot = 1;

/** Create a swap out that pays out on chain to a Taproot MuSig2 swap output

  {
    deposit: <Swap Deposit Tokens Number>
    expiry: <Swap Timeout Height Number>
    fee: <Swap Fee Tokens Number>
    hash: <Swap Hash Hex String>
    key: <Client Claim Public Key Hex String>
    lnd: <Authenticated LND API Object>
    network: <Network Name String>
    tokens: <Swap Tokens Number>
  }

  @returns via cbk or Promise
  {
    address: <Swap Funding Chain Address String>
    deposit_id: <Deposit Invoice Payment Hash Hex String>
    deposit_request: <Deposit Invoice BOLT 11 Request String>
    deposit_secret: <Deposit Invoice Preimage Hex String>
    fund_payment: <Funding Invoice Payment Identifier Hex String>
    fund_request: <Funding Invoice BOLT 11 Request String>
    key_index: <Server Key Index Number>
    output_script: <Swap Funding Output Script Hex String>
    root_hash: <Swap Script Tree Root Hash Hex String>
    server_key: <Server Public Key Hex String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.deposit) {
          return cbk([400, 'ExpectedDepositTokensToCreateSwapOut']);
        }

        if (!args.expiry) {
          return cbk([400, 'ExpectedExpiryHeightToCreateSwapOut']);
        }

        if (args.fee === undefined) {
          return cbk([400, 'ExpectedSwapFeeTokensToCreateSwapOut']);
        }

        if (!args.hash) {
          return cbk([400, 'ExpectedSwapHashToCreateSwapOut']);
        }

        if (!args.key) {
          return cbk([400, 'ExpectedClientClaimKeyToCreateSwapOut']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToCreateSwapOut']);
        }

        if (!bech32Prefixes[args.network]) {
          return cbk([400, 'ExpectedKnownNetworkNameToCreateSwapOut']);
        }

        if (!args.tokens) {
          return cbk([400, 'ExpectedSwapTokensToCreateSwapOut']);
        }

        return cbk();
      },

      // Generate the deposit secret
      secret: ['validate', ({}, cbk) => {
        return cbk(null, bufferAsHex(randomBytes(secretByteLength)));
      }],

      // Get the server key for the swap
      getKey: ['validate', ({}, cbk) => {
        return getPublicKey({family: keyFamily, lnd: args.lnd}, cbk);
      }],

      // Derive the swap script tree
      branches: ['getKey', asyncify(({getKey}) => {
        const {branches} = swapScriptBranches({
          claim_public_key: args.key,
          hash: args.hash,
          refund_public_key: getKey.public_key,
          timeout: args.expiry,
        });

        return {root_hash: hashForTree({branches}).hash};
      })],

      // Derive the swap output key that aggregates the client and server keys
      getOutputKey: ['branches', 'getKey', ({branches, getKey}, cbk) => {
        return beginGroupSigningSession({
          key_family: keyFamily,
          key_index: getKey.index,
          lnd: args.lnd,
          public_keys: [args.key, getKey.public_key],
          root_hash: branches.root_hash,
        },
        cbk);
      }],

      // The signing session was only used to derive the output key
      endSession: ['getOutputKey', ({getOutputKey}, cbk) => {
        return endGroupSigningSession({
          id: getOutputKey.id,
          lnd: args.lnd,
        },
        cbk);
      }],

      // Create the deposit invoice, held until the swap is funded on chain
      createDeposit: ['secret', ({secret}, cbk) => {
        return createHodlInvoice({
          description: depositDescription,
          id: sha256(hexAsBuffer(secret)),
          lnd: args.lnd,
          tokens: args.deposit,
        },
        cbk);
      }],

      // Create the held funding invoice that is locked to the swap hash
      createFunding: ['validate', ({}, cbk) => {
        return createHodlInvoice({
          description: fundingDescription,
          id: args.hash,
          lnd: args.lnd,
          tokens: args.tokens + args.fee - args.deposit,
        },
        cbk);
      }],

      // Final swap details
      swap: [
        'branches',
        'createDeposit',
        'createFunding',
        'getKey',
        'getOutputKey',
        'secret',
        ({
          branches,
          createDeposit,
          createFunding,
          getKey,
          getOutputKey,
          secret,
        },
        cbk) =>
      {
        const {address} = encodeBech32Address({
          prefix: bech32Prefixes[args.network],
          program: hexAsBuffer(getOutputKey.external_key),
          version: witnessVersionTaproot,
        });

        const {request} = createFunding;

        const {payment} = parsePaymentRequest({request});

        return cbk(null, {
          address,
          deposit_id: createDeposit.id,
          deposit_request: createDeposit.request,
          deposit_secret: secret,
          fund_payment: payment,
          fund_request: createFunding.request,
          key_index: getKey.index,
          output_script: outputScriptForKey(getOutputKey.external_key),
          root_hash: branches.root_hash,
          server_key: getKey.public_key,
        });
      }],
    },
    returnResult({reject, resolve, of: 'swap'}, cbk));
  });
};
