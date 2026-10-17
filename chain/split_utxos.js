const asyncAuto = require('async/auto');
const asyncEach = require('async/each');
const asyncMapSeries = require('async/mapSeries');
const asyncReflect = require('async/reflect');
const {broadcastChainTransaction} = require('ln-service');
const {createChainAddress} = require('ln-service');
const {fundPsbt} = require('ln-service');
const {getChainFeeRate} = require('ln-service');
const {getUtxos} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {signPsbt} = require('ln-service');
const {unlockUtxo} = require('ln-service');

const utxoSplitPlan = require('./utxo_split_plan');

const asOutpoint = n => `${n.transaction_id}:${n.transaction_vout}`;
const {ceil} = Math;
const format = 'p2wpkh';
const minimumUtxoTokens = 1e5;
const newArrayOfSize = n => Array.from(Array(n));

/** Ensure there are a certain number of utxos greater than or equal to a size

  Spending a utxo that already counts removes it from the count, so the split
  replaces spent counted utxos and counts the change when it is large enough.

  The inputs to spend are selected so that the split reaches the count, and
  when the funds cannot support the count, the split is rejected.

  Only confirmed utxos are spent

  {
    count: <Count of UTXOs Number>
    [is_confirmed]: <Only Consider Confirmed Utxos Bool>
    [is_dry_run]: <Do Not Execute Split Bool>
    lnd: <Authenticated LND API Object>
    size: <UTXO Minimum Tokens Number>
    [tokens_per_vbyte]: <Fee Tokens Per Virtual Byte Number>
  }

  @returns via cbk
  {
    needed_outputs: <Split Outputs Count Number>
    sent_to: [<Split Output Address String>]
    [transaction_id]: <Split Transaction Id Hex String>
  }
*/
module.exports = (args, cbk) => {
  return asyncAuto({
    // Check arguments
    validate: cbk => {
      if (!args.count) {
        return cbk([400, 'ExpectedSplitUtxosCountNumber']);
      }

      if (!args.lnd) {
        return cbk([400, 'ExpectedAuthenticatedLndToSplitUtxos']);
      }

      if (!args.size || args.size < minimumUtxoTokens) {
        return cbk([400, 'ExpectedSizeOfUtxosToSplitTo']);
      }

      return cbk();
    },

    // Get the fee rate to pay for the split
    feeRate: ['validate', ({}, cbk) => {
      // Exit early when the fee rate is specified
      if (!!args.tokens_per_vbyte) {
        return cbk(null, args.tokens_per_vbyte);
      }

      return getChainFeeRate({lnd: args.lnd}, (err, res) => {
        if (!!err) {
          return cbk(err);
        }

        // Round up the estimated rate since the split pays whole rates
        return cbk(null, ceil(res.tokens_per_vbyte));
      });
    }],

    // Get all the current UTXOs
    getUtxos: ['validate', ({}, cbk) => getUtxos({lnd: args.lnd}, cbk)],

    // Select the inputs and the count of outputs that reach the count
    plan: ['feeRate', 'getUtxos', ({feeRate, getUtxos}, cbk) => {
      try {
        const plan = utxoSplitPlan({
          count: args.count,
          fee_tokens_per_vbyte: feeRate,
          is_confirmed: args.is_confirmed,
          size: args.size,
          utxos: getUtxos.utxos,
        });

        return cbk(null, plan);
      } catch (err) {
        return cbk([400, err.message]);
      }
    }],

    // Generate addresses
    getAddresses: ['plan', ({plan}, cbk) => {
      // Exit early when not creating any outputs
      if (!!args.is_dry_run || !plan.outputs) {
        return cbk(null, []);
      }

      return asyncMapSeries(newArrayOfSize(plan.outputs), (_, cbk) => {
        return createChainAddress({format, lnd: args.lnd}, cbk);
      },
      cbk);
    }],

    // Fund the split outputs by spending the selected inputs
    fund: [
      'feeRate',
      'getAddresses',
      'plan',
      ({feeRate, getAddresses, plan}, cbk) =>
    {
      // Exit early when there are no outputs to fund
      if (!getAddresses.length) {
        return cbk();
      }

      const tokens = args.size;

      return fundPsbt({
        fee_tokens_per_vbyte: feeRate,
        inputs: plan.inputs,
        lnd: args.lnd,
        outputs: getAddresses.map(({address}) => ({address, tokens})),
      },
      cbk);
    }],

    // Make sure the funded split reaches the count before signing it
    checkFunding: [
      'fund',
      'getUtxos',
      asyncReflect(({fund, getUtxos}, cbk) =>
    {
      // Exit early when there is no funded split to check
      if (!fund) {
        return cbk();
      }

      const spending = fund.inputs.map(asOutpoint);

      // Counted utxos that are not spent in the split remain counted
      const remaining = getUtxos.utxos
        .filter(n => !args.is_confirmed || !!n.confirmation_count)
        .filter(n => n.tokens >= args.size)
        .filter(n => !spending.includes(asOutpoint(n)));

      // Split outputs and change that are large enough are counted
      const created = fund.outputs.filter(n => n.tokens >= args.size);

      // Exit early with an error when the split would not reach the count
      if (remaining.length + created.length < args.count) {
        return cbk([503, 'ExpectedFundedSplitToReachCountOfUtxos']);
      }

      return cbk();
    })],

    // Sign the funded split
    sign: [
      'checkFunding',
      'fund',
      asyncReflect(({checkFunding, fund}, cbk) =>
    {
      // Exit early when there is no funded split to sign
      if (!fund || !!checkFunding.error) {
        return cbk();
      }

      return signPsbt({lnd: args.lnd, psbt: fund.psbt}, cbk);
    })],

    // Broadcast the signed split
    broadcast: ['sign', asyncReflect(({sign}, cbk) => {
      // Exit early when there is no signed split to broadcast
      if (!sign.value) {
        return cbk();
      }

      return broadcastChainTransaction({
        lnd: args.lnd,
        transaction: sign.value.transaction,
      },
      cbk);
    })],

    // Release the locks on the inputs when the split is not broadcast
    unlock: [
      'broadcast',
      'checkFunding',
      'fund',
      'sign',
      ({broadcast, checkFunding, fund, sign}, cbk) =>
    {
      const error = checkFunding.error || sign.error || broadcast.error;

      // Exit early when nothing stopped the split
      if (!error) {
        return cbk();
      }

      return asyncEach(fund.inputs, (input, cbk) => {
        return unlockUtxo({
          id: input.lock_id,
          lnd: args.lnd,
          transaction_id: input.transaction_id,
          transaction_vout: input.transaction_vout,
        },
        () => {
          // Ignore errors unlocking a UTXO, the lock will expire on its own
          return cbk();
        });
      },
      () => {
        // Return the original error that stopped the split
        return cbk(error);
      });
    }],

    // Utxos
    utxos: [
      'broadcast',
      'getAddresses',
      'plan',
      'unlock',
      ({broadcast, getAddresses, plan}, cbk) =>
    {
      return cbk(null, {
        needed_outputs: plan.outputs,
        sent_to: getAddresses.map(({address}) => address),
        transaction_id: !!broadcast.value ? broadcast.value.id : undefined,
      });
    }],
  },
  returnResult({of: 'utxos'}, cbk));
};
