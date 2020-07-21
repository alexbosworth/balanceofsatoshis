const asyncAuto = require('async/auto');
const asyncTimesSeries = require('async/timesSeries');
const {attemptSweep} = require('goldengate');
const {returnResult} = require('asyncjs-util');

const defaultMaxWaitBlocks = Number.MAX_SAFE_INTEGER;
const {isArray} = Array;
const {maxFeeMultiplier} = require('./constants');
const {min} = Math;

/** Get raw recovery transactions

  {
    confs: <Confirmation Count Number>
    [deposit_height]: <Swap Deposit Confirm Height String>
    lnd: <Authenticated LND API Object>
    [max_wait_blocks]: <Maximum Blocks to Wait Number>
    network: <Network Name String>
    private_key: <Claim Private Key String>
    script: <Swap Script Hex String>
    secret: <Claim Secret Preimage Hex String>
    [sends]: [{
      address: <Send to Address String>
      tokens: <Send Tokens Number>
    }]
    start_height: <Swap Start Height Number>
    sweep_address: <Sweep Out to Address String>
    timeout: <Swap Timeout Height Number>
    tokens: <Swap Tokens Number>
    transaction_id: <Funds Transaction Id Hex String>
    transaction_vout: <Funds Transaction Output Index Number>
  }

  @returns via cbk or Promise
  {
    recoveries: [{
      fee_rate: <Fee Rate Number>
      min_fee_rate: <Minimum Tokens Per VByte Fee Rate Number>
      timelock_height: <Timelock Height Number>
      transaction: <Raw Transaction Hex String>
    }]
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.confs) {
          return cbk([400, 'ExpectedConfsToGetRawRecoveries']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToGetRawSwapRecoveries']);
        }

        if (!args.private_key) {
          return cbk([400, 'ExpectedSwapPrivateKeyToGetRawSwapRecoveries']);
        }

        if (!args.script) {
          return cbk([400, 'ExpectedSwapScriptToGetRawSwapRecoveries']);
        }

        if (!args.secret) {
          return cbk([400, 'ExpectedSecretToGetRawSwapRecoveries']);
        }

        if (!args.start_height) {
          return cbk([400, 'ExpectedStartHeightToGetRawRecoveries']);
        }

        if (!args.sweep_address) {
          return cbk([400, 'ExpectedSweepAddressToGetRawSwapRecoveries']);
        }

        if (!args.timeout) {
          return cbk([400, 'ExpectedTimeoutToGetRawRecoveries']);
        }

        if (!args.tokens) {
          return cbk([400, 'ExpectedTokensToGetRawRecoveries']);
        }

        if (!args.transaction_id) {
          return cbk([400, 'ExpectedSwapTransactionIdHexStringForRecoveries']);
        }

        if (args.transaction_vout === undefined) {
          return cbk([400, 'ExpectedSwapTxOutputIndexToGetRawRecoveries']);
        }

        return cbk();
      },

      // Raw recovery transactions
      getAttempts: ['validate', ({}, cbk) => {
        let cursor;
        let minFeeRate;
        const maxWaitBlocks = args.max_wait_blocks || defaultMaxWaitBlocks;

        const maxWaitHeight = args.start_height + maxWaitBlocks;

        const deadlineHeight = min(maxWaitHeight, args.timeout - args.confs);

        return asyncTimesSeries(args.timeout - args.start_height, (i, cbk) => {
          return attemptSweep({
            current_height: args.start_height + i,
            deadline_height: deadlineHeight,
            is_dry_run: true,
            lnd: args.lnd,
            max_fee_multiplier: maxFeeMultiplier,
            min_fee_rate: minFeeRate,
            network: args.network,
            private_key: args.private_key,
            secret: args.secret,
            sends: args.sends,
            start_height: args.deposit_height || args.start_height,
            sweep_address: args.sweep_address,
            tokens: args.tokens,
            transaction_id: args.transaction_id,
            transaction_vout: args.transaction_vout,
            witness_script: args.script,
          },
          (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            if (!!cursor && cursor === res.fee_rate) {
              return cbk();
            }

            cursor = res.fee_rate;

            return cbk(null, {
              fee_rate: res.fee_rate,
              min_fee_rate: res.min_fee_rate,
              timelock_height: args.start_height + i,
              transaction: res.transaction,
            });
          });
        },
        cbk);
      }],

      // Return the set of recoveries
      recoveries: ['getAttempts', ({getAttempts}, cbk) => {
        return cbk(null, {recoveries: getAttempts.filter(n => !!n)});
      }],
    },
    returnResult({reject, resolve, of: 'recoveries'}, cbk));
  });
};
