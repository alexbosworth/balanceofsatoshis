const asyncAuto = require('async/auto');
const {broadcastChainTransaction} = require('ln-service');
const {componentsOfTransaction} = require('@alexbosworth/blockchain');
const {fundPsbt} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {settleHodlInvoice} = require('ln-service');
const {signPsbt} = require('ln-service');

const waitForHeldInvoice = require('./wait_for_held_invoice');

/** Fund a swap out on chain once its deposit and funding payments are held

  {
    address: <Swap Funding Chain Address String>
    deposit_id: <Deposit Invoice Payment Hash Hex String>
    deposit_secret: <Deposit Invoice Preimage Hex String>
    hash: <Swap Hash Hex String>
    lnd: <Authenticated LND API Object>
    output_script: <Swap Funding Output Script Hex String>
    tokens: <Swap Tokens Number>
  }

  @returns via cbk or Promise
  {
    transaction_id: <Swap Funding Transaction Id Hex String>
    transaction_vout: <Swap Funding Transaction Output Index Number>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.address) {
          return cbk([400, 'ExpectedSwapAddressToFundSwapOut']);
        }

        if (!args.deposit_id) {
          return cbk([400, 'ExpectedDepositIdToFundSwapOut']);
        }

        if (!args.deposit_secret) {
          return cbk([400, 'ExpectedDepositSecretToFundSwapOut']);
        }

        if (!args.hash) {
          return cbk([400, 'ExpectedSwapHashToFundSwapOut']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToFundSwapOut']);
        }

        if (!args.output_script) {
          return cbk([400, 'ExpectedSwapOutputScriptToFundSwapOut']);
        }

        if (!args.tokens) {
          return cbk([400, 'ExpectedSwapTokensToFundSwapOut']);
        }

        return cbk();
      },

      // Wait for the deposit payment to be held
      waitForDeposit: ['validate', ({}, cbk) => {
        return waitForHeldInvoice({id: args.deposit_id, lnd: args.lnd}, cbk);
      }],

      // Wait for the funding payment to be held
      waitForFunding: ['validate', ({}, cbk) => {
        return waitForHeldInvoice({id: args.hash, lnd: args.lnd}, cbk);
      }],

      // Fund the swap output transaction
      fund: ['waitForDeposit', 'waitForFunding', ({}, cbk) => {
        return fundPsbt({
          lnd: args.lnd,
          outputs: [{address: args.address, tokens: args.tokens}],
        },
        cbk);
      }],

      // Sign the swap output transaction
      sign: ['fund', ({fund}, cbk) => {
        return signPsbt({lnd: args.lnd, psbt: fund.psbt}, cbk);
      }],

      // Publish the swap output transaction
      publish: ['sign', ({sign}, cbk) => {
        return broadcastChainTransaction({
          lnd: args.lnd,
          transaction: sign.transaction,
        },
        cbk);
      }],

      // Take the deposit now that the swap is published
      settleDeposit: ['publish', ({}, cbk) => {
        return settleHodlInvoice({
          lnd: args.lnd,
          secret: args.deposit_secret,
        },
        cbk);
      }],

      // Swap funding outpoint
      funding: ['publish', 'sign', ({publish, sign}, cbk) => {
        const {transaction} = sign;

        const {outputs} = componentsOfTransaction({transaction});

        const vout = outputs.findIndex(n => n.script === args.output_script);

        return cbk(null, {transaction_id: publish.id, transaction_vout: vout});
      }],
    },
    returnResult({reject, resolve, of: 'funding'}, cbk));
  });
};
