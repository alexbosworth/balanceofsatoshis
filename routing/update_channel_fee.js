const asyncAuto = require('async/auto');
const {getChannel} = require('ln-service');
const {getChannels} = require('ln-service');
const {getPendingChannels} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {updateRoutingFees} = require('ln-service');

const {abs} = Math;
const asOut = n => `${n.transaction_id}:${n.transaction_vout}`;
const feeRateBuffer = 1;

/** Update the fee for an individual channel

  {
    [base_fee_mtokens]: <Base Fee Millitokens String>
    [cltv_delta]: <CLTV Delta to Use Number>
    fee_rate: <Fee Rate Number>
    from: <Local Node Public Key Hex String>
    lnd: <Authenticated LND API Object>
    transaction_id: <Funding Transaction Id Hex String>
    transaction_vout: <Funding Transaction Output Index Number>
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (args.fee_rate === undefined) {
          return cbk([400, 'ExpectedFeeRateToUpdateChannelFee']);
        }

        if (!args.from) {
          return cbk([400, 'ExpectedFromPublicKeyToUpdateChannelFee']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToUpdateChannelFee']);
        }

        if (!args.transaction_id) {
          return cbk([400, 'ExpectedTransactionIdToUpdateChannelFee']);
        }

        if (args.transaction_vout === undefined) {
          return cbk([400, 'ExpectedTransactionVoutToUpdateChannelFee']);
        }

        return cbk();
      },

      // Get the list of pending channels
      getPending: ['validate', ({}, cbk) => {
        return getPendingChannels({lnd: args.lnd}, cbk);
      }],

      // Check that the channel is not pending
      checkPending: ['getPending', ({getPending}, cbk) => {
        const channel = args.transaction_id;
        const pending = getPending.pending_channels.filter(n => n.is_opening);

        if (!!pending.find(n => asOut(n) === asOut(args))) {
          return cbk([503, 'ChannelToSetFeeRateForIsStillPending', {channel}]);
        }

        return cbk();
      }],

      // Get the list of active channels
      getChannels: ['checkPending', ({}, cbk) => {
        return getChannels({lnd: args.lnd}, cbk);
      }],

      // Get channel id
      getChannelId: ['getChannels', ({getChannels}, cbk) => {
        const chan = getChannels.channels.find(n => asOut(n) === asOut(args));

        if (!chan) {
          return cbk([404, 'ExpectedKnownChannelToUpdateChannelFee']);
        }

        return cbk(null, chan.id);
      }],

      // Get the existing channel routing policies
      getChannel: ['getChannelId', ({getChannelId}, cbk) => {
        return getChannel({lnd: args.lnd, id: getChannelId}, cbk);
      }],

      // Find the current policy for this channel
      policy: ['getChannel', ({getChannel}, cbk) => {
        const rate = getChannel.policies.find(n => n.public_key === args.from);

        if (!rate) {
          return cbk([404, 'ExpectedExistingChannelPolicyToUpdate']);
        }

        if (!rate.base_fee_mtokens) {
          return cbk([404, 'UnexpectedMissingBaseFeeMtokensUpdatingChanFee']);
        }

        if (!rate.cltv_delta) {
          return cbk([404, 'UnexpectedMissingCltvDeltaUpdatingChannelFee']);
        }

        return cbk(null, rate);
      }],

      // Update the fee rate to the specified rate
      updateFeeRate: ['policy', ({policy}, cbk) => {
        return updateRoutingFees({
          base_fee_mtokens: args.base_fee_mtokens || policy.base_fee_mtokens,
          cltv_delta: args.cltv_delta || policy.cltv_delta,
          fee_rate: args.fee_rate,
          lnd: args.lnd,
          transaction_id: args.transaction_id,
          transaction_vout: args.transaction_vout,
        },
        cbk);
      }],

      // Get the updated channel routing policies
      getUpdated: ['getChannelId', 'updateFeeRate', ({getChannelId}, cbk) => {
        return getChannel({lnd: args.lnd, id: getChannelId}, cbk);
      }],

      // Make sure that the fee rate has been applied
      checkUpdated: ['getUpdated', ({getUpdated}, cbk) => {
        const rate = getUpdated.policies.find(n => n.public_key === args.from);

        if (abs(rate.fee_rate - args.fee_rate) > feeRateBuffer) {
          return cbk([503, 'FailedToUpdateChannelPolicyToNewFeeRate', {rate}]);
        }

        return cbk();
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
