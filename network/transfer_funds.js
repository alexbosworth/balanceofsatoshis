const asyncAuto = require('async/auto');
const {createInvoice} = require('ln-service');
const {findKey} = require('ln-sync');
const {formatTokens} = require('ln-sync');
const {getChannels} = require('ln-service');
const {getIdentity} = require('ln-service');
const {getPeerLiquidity} = require('ln-sync');
const {returnResult} = require('asyncjs-util');

const {parseAmount} = require('./../display');
const probeDestination = require('./probe_destination');

const defaultDescription = 'bos transfer between saved nodes';
const feeForRate = (rate, n) => Number(BigInt(n) * BigInt(rate) / BigInt(1e6));
const {isArray} = Array;
const rateForFee = (n, fee) => Number(BigInt(fee) * BigInt(1e6) / BigInt(n));
const sumOf = arr => arr.reduce((sum, n) => sum + n, Number());
const minTokens = 1;
const tokAsBigTok = tokens => !tokens ? undefined : (tokens / 1e8).toFixed(8);

/** Transfer funds to a destination

  {
    amount: <Amount to Transfer Tokens String>
    [description]: <Description String>
    [in_through]: <Transfer In Through Peer String>
    [is_dry_run]: <Do Not Transfer Bool>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    max_fee_rate: <Maximum Fee Rate Number>
    [out_through]: <Transfer Out Through Peer String>
    to: <Send To Authenticated LND API Object>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.amount) {
          return cbk([400, 'ExpectedAmountToTransferFundsToSavedNode']);
        }

        if (!!args.in_through && !!isArray(args.in_through)) {
          return cbk([400, 'MultipleInThroughPeersNotSupported']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToTransferFundsToNode']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerForFundsTransferToSavedNode']);
        }

        if (args.max_fee_rate === undefined) {
          return cbk([400, 'ExpectedMaxFeeRateToTransferFundsToSavedNode']);
        }

        if (!!args.out_through && !!isArray(args.out_through)) {
          return cbk([400, 'MultipleOutThroughPeersNotSupported']);
        }

        if (!args.to) {
          return cbk([400, 'ExpectedDestinationSavedNodeToTransferFundsTo']);
        }

        return cbk();
      },

      // Get channels with the peer in order to populate liquidity
      getChannels: ['validate', ({}, cbk) => {
        return getChannels({lnd: args.lnd}, cbk);
      }],

      // Get the channels of the destination
      getRemoteChannels: ['validate', ({}, cbk) => {
        return getChannels({lnd: args.to}, cbk);
      }],

      // Get the key of the node we are sending from
      getFromKey: ['validate', ({}, cbk) => getIdentity({lnd: args.lnd}, cbk)],

      // Get the key of the node we are sending to
      getToKey: ['validate', ({}, cbk) => getIdentity({lnd: args.to}, cbk)],

      // Make sure that this is a transfer and not a send-to-self
      checkDestination: [
        'getFromKey',
        'getToKey',
        ({getFromKey, getToKey}, cbk) =>
      {
        if (getFromKey.public_key === getToKey.public_key) {
          return cbk([400, 'FromNodeAndToNodeCannotBeEqual']);
        }

        return cbk();
      }],

      // Determine the inbound peer public key
      getInKey: ['getRemoteChannels', ({getRemoteChannels}, cbk) => {
        // Exit early when there is no inbound constraint
        if (!args.in_through) {
          return cbk(null, {});
        }

        return findKey({
          channels: getRemoteChannels.channels,
          lnd: args.to,
          query: args.in_through,
        },
        cbk);
      }],

      // Determine the outbound peer public key
      getOutKey: ['getChannels', ({getChannels}, cbk) => {
        // Exit early when there is no outbound constraint
        if (!args.out_through) {
          return cbk(null, {});
        }

        return findKey({
          channels: getChannels.channels,
          lnd: args.lnd,
          query: args.out_through,
        },
        cbk);
      }],

      // Parse the amount specified
      parseAmount: [
        'getChannels',
        'getOutKey',
        'getToKey',
        ({getChannels, getOutKey, getToKey}, cbk) =>
      {
        // Calculate the outbound peer inbound liquidity
        const outInbound = getChannels.channels
          .filter(n => n.partner_public_key === getOutKey.public_key)
          .reduce((sum, chan) => {
            // Treat incoming payment as if they were still remote balance
            const inbound = chan.pending_payments.filter(n => !n.is_outgoing);

            const pending = sumOf(inbound.map(({tokens}) => tokens));

            return sum + chan.remote_balance + pending;
          },
          Number());

        // Calculate the outbound peer outbound liquidity
        const outOutbound = getChannels.channels
          .filter(n => n.partner_public_key === getOutKey.public_key)
          .reduce((sum, chan) => {
            // Treat outgoing payment as if they were still local balance
            const outbound = chan.pending_payments
              .filter(n => !!n.is_outgoing);

            const pending = sumOf(outbound.map(({tokens}) => tokens));

            return sum + chan.local_balance + pending;
          },
          Number());

        // Variables to use in amount
        const variables = {
          out_inbound: outInbound,
          out_liquidity: sumOf(
            getChannels.channels
              .filter(n => n.partner_public_key === getOutKey.public_key)
              .map(n => n.capacity)
          ),
          out_outbound: outOutbound,
        };

        if (!!args.out_through) {
          args.logger.info(variables);
        }

        try {
          return cbk(null, parseAmount({variables, amount: args.amount}));
        } catch (err) {
          return cbk([400, 'FailedToParseTransferAmount', err]);
        }
      }],

      // Check if the amount can route to the destination
      probe: [
        'getInKey',
        'getOutKey',
        'getToKey',
        'parseAmount',
        ({getInKey, getOutKey, getToKey, parseAmount}, cbk) =>
      {
        if (parseAmount.tokens < minTokens) {
          return cbk([400, 'ExpectedNonZeroAmountToTransferFundsToSavedNode']);
        }

        return probeDestination({
          destination: getToKey.public_key,
          lnd: args.lnd,
          logger: args.logger,
          in_through: getInKey.public_key,
          out_through: getOutKey.public_key,
          timeout_minutes: args.timeout_minutes,
          tokens: parseAmount.tokens,
        },
        cbk);
      }],

      // Create the invoice on the receiving side
      createInvoice: [
        'checkDestination',
        'parseAmount',
        'probe',
        ({parseAmount, probe}, cbk) =>
      {
        if (!probe.success) {
          return cbk([400, 'FailedToFindPathToDestination']);
        }

        // Exit early when this is a dry run
        if (!!args.is_dry_run) {
          return cbk(null, {tokens: parseAmount.tokens});
        }

        const maxFee = feeForRate(args.max_fee_rate, parseAmount.tokens);
        const minFeeRate = rateForFee(parseAmount.tokens, probe.fee);

        if (probe.fee > maxFee) {
          return cbk([400, 'InsufficientMaxFeeRate', {needed: minFeeRate}]);
        }

        return createInvoice({
          description: args.description || defaultDescription,
          lnd: args.to,
          tokens: parseAmount.tokens,
        },
        cbk);
      }],

      // Transfer the amount to the destination
      transfer: [
        'createInvoice',
        'getInKey',
        'getOutKey',
        'getToKey',
        ({createInvoice, getInKey, getOutKey, getToKey}, cbk) =>
      {
        const maxFee = feeForRate(args.max_fee_rate, createInvoice.tokens);

        args.logger.info({
          max_fee: maxFee,
          paying: formatTokens({tokens: createInvoice.tokens}).display,
          to: getToKey.public_key,
        });

        if (!!args.is_dry_run) {
          return cbk([400, 'TransferFundsDryRun']);
        }

        return probeDestination({
          lnd: args.lnd,
          logger: args.logger,
          in_through: getInKey.public_key,
          is_real_payment: true,
          max_fee: maxFee,
          out_through: getOutKey.public_key,
          request: createInvoice.request,
          timeout_minutes: args.timeout_minutes,
        },
        cbk);
      }],

      // Get adjusted iinbound liquidity after transfer
      getAdjustedInbound: ['transfer', ({transfer}, cbk) => {
        // Exit early when the payment failed
        if (!transfer.preimage) {
          return cbk([503, 'UnexpectedSendPaymentFailure']);
        }

        // Exit early when there is no outbound constraint
        if (!args.out_through) {
          return cbk();
        }

        const [, inbound] = transfer.relays.slice().reverse();

        return getPeerLiquidity({
          lnd: args.to,
          public_key: inbound,
          settled: transfer.id,
        },
        cbk);
      }],

      // Get adjusted outbound liquidity after transfer
      getAdjustedOutbound: ['transfer', ({transfer}, cbk) => {
        // Exit early when the payment failed
        if (!transfer.preimage) {
          return cbk([503, 'UnexpectedSendPaymentFailure']);
        }

        // Exit early when there is no outbound constraint
        if (!args.out_through) {
          return cbk();
        }

        const [out] = transfer.relays;

        return getPeerLiquidity({
          lnd: args.lnd,
          public_key: out,
          settled: transfer.id,
        },
        cbk);
      }],

      // Final liquidity outcome
      liquidity: [
        'getAdjustedInbound',
        'getAdjustedOutbound',
        'transfer',
        ({getAdjustedInbound, getAdjustedOutbound, transfer}, cbk) =>
      {
        if (!getAdjustedOutbound) {
          return cbk();
        }

        const [out] = transfer.relays;
        const outOpeningIn = getAdjustedOutbound.inbound_opening;
        const outOpeningOut = getAdjustedOutbound.outbound_opening;
        const outPendingIn = getAdjustedOutbound.inbound_pending;
        const outPendingOut = getAdjustedOutbound.outbound_pending;

        const [, inbound] = transfer.relays.slice().reverse();
        const inboundAlias = getAdjustedInbound.alias;
        const inOpeningIn = getAdjustedInbound.inbound_opening;
        const inOpeningOut = getAdjustedInbound.outbound_opening;
        const inPendingIn = getAdjustedInbound.inbound_pending;
        const inPendingOut = getAdjustedInbound.outbound_pending;

        args.logger.info({
          local_liquidity_change: {
            increased_inbound_on: `${getAdjustedOutbound.alias} ${out}`.trim(),
            liquidity_inbound: tokAsBigTok(getAdjustedOutbound.inbound),
            liquidity_inbound_opening: tokAsBigTok(outOpeningIn),
            liquidity_inbound_pending: tokAsBigTok(outPendingIn),
            liquidity_outbound: tokAsBigTok(getAdjustedOutbound.outbound),
            liquidity_outbound_opening: tokAsBigTok(outOpeningOut),
            liquidity_outbound_pending: tokAsBigTok(outPendingOut),
          },
          remote_liquidity_change: {
            decreased_inbound_on: `${inboundAlias} ${inbound}`.trim(),
            liquidity_inbound: tokAsBigTok(getAdjustedInbound.inbound),
            liquidity_inbound_opening: tokAsBigTok(inOpeningIn),
            liquidity_inbound_pending: tokAsBigTok(inPendingIn),
            liquidity_outbound: tokAsBigTok(getAdjustedInbound.outbound),
            liquidity_outbound_opening: tokAsBigTok(inOpeningOut),
            liquidity_outbound_pending: tokAsBigTok(inPendingOut),
          },
        });

        return cbk();
      }],
    },
    returnResult({reject, resolve, of: 'transfer'}, cbk));
  });
};
