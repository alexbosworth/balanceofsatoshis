const asyncAuto = require('async/auto');
const asyncMapSeries = require('async/mapSeries');
const {returnResult} = require('asyncjs-util');
const {signSharedUtxosRefund} = require('goldengate');

const {refundDustErrors} = require('./constants');
const {sharedAddressKeyFamily} = require('./constants');

const {isArray} = Array;
const isDustError = err => !!err && refundDustErrors.includes(err[1]);

/** Sign refunds of swap in deposits at fee rates that unlock at heights

  {
    expiry: <Shared Address Expiry Blocks Count Number>
    key_index: <Shared Address Client Key Index Number>
    lnd: <Authenticated LND API Object>
    network: <Network Name String>
    rates: [{
      fee_rate: <Fee Tokens Per VByte Number>
      height: <Timelock Block Height Number>
    }]
    service_public_key: <Shared Address Service Public Key Hex String>
    sweep_address: <Refund to Chain Address String>
    utxos: [{
      tokens: <Deposit Tokens Number>
      transaction_id: <Deposit Transaction Id Hex String>
      transaction_vout: <Deposit Transaction Output Index Number>
    }]
  }

  @returns via cbk or Promise
  {
    refunds: [{
      fee_rate: <Fee Tokens Per VByte Number>
      height: <Timelock Block Height Number>
      id: <Refund Transaction Id Hex String>
      transaction: <Signed Refund Transaction Hex String>
    }]
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToSignDepositRefunds']);
        }

        if (!isArray(args.rates) || !args.rates.length) {
          return cbk([400, 'ExpectedFeeRatesToSignDepositRefunds']);
        }

        return cbk();
      },

      // Sign a refund of the deposits at every fee rate
      sign: ['validate', ({}, cbk) => {
        return asyncMapSeries(args.rates, (rate, cbk) => {
          return signSharedUtxosRefund({
            block_height: rate.height,
            expiry: args.expiry,
            fee_tokens_per_vbyte: rate.fee_rate,
            key_family: sharedAddressKeyFamily,
            key_index: args.key_index,
            lnd: args.lnd,
            network: args.network,
            service_public_key: args.service_public_key,
            sweep_address: args.sweep_address,
            utxos: args.utxos,
          },
          (err, res) => {
            // Exit early when the fee rate leaves too little to refund
            if (isDustError(err)) {
              return cbk();
            }

            if (!!err) {
              return cbk(err);
            }

            return cbk(null, {
              fee_rate: rate.fee_rate,
              height: rate.height,
              id: res.id,
              transaction: res.transaction,
            });
          });
        },
        cbk);
      }],

      // The refunds that are above dust
      refunds: ['sign', ({sign}, cbk) => {
        return cbk(null, {refunds: sign.filter(n => !!n)});
      }],
    },
    returnResult({reject, resolve, of: 'refunds'}, cbk));
  });
};
