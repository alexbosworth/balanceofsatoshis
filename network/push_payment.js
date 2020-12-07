const asyncAuto = require('async/auto');
const {formatTokens} = require('ln-sync');
const {getChannels} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {returnResult} = require('asyncjs-util');

const {getCoingeckoRates} = require('./../fiat');
const {parseAmount} = require('./../display');
const probeDestination = require('./probe_destination');

const coins = ['BTC', 'LTC'];
const fiats = ['EUR', 'USD'];
const isPublicKey = n => /^[0-9A-F]{66}$/i.test(n);
const rateAsTokens = rate => 1e8 / rate;
const sumOf = arr => arr.reduce((sum, n) => sum + n, Number());
const networks = {btc: 'BTC', btctestnet: 'BTC', ltc: 'LTC'};

/** Push a payment to a destination

  {
    amount: <Amount to Push Tokens String>
    destination: <Destination Public Key Hex String>
    [is_dry_run]: <Do Not Push Payment Bool>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    max_fee: <Maximum Fee Tokens Number>
    [message]: <Message to Include With Payment String>
    request: <Request Function>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.amount) {
          return cbk([400, 'ExpectedAmountToSendInPushPayment']);
        }

        if (!isPublicKey(args.destination)) {
          return cbk([400, 'ExpectedDestinationToPushPaymentTo']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToPushPayment']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToPushPayment']);
        }

        if (args.max_fee === undefined) {
          return cbk([400, 'ExpectedMaxFeeAmountToPushPayment']);
        }

        if (!args.request) {
          return cbk([400, 'ExpectedRequestFunctionToPushPayment']);
        }

        return cbk();
      },

      // Get channels with the peer in order to populate liquidity
      getChannels: ['validate', ({}, cbk) => {
        return getChannels({
          lnd: args.lnd,
          partner_public_key: args.destination,
        },
        cbk);
      }],

      // Get network name
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd: args.lnd}, cbk)],

      // Get the current price of BTCUSD
      getFiatPrice: ['validate', ({}, cbk) => {
        return getCoingeckoRates({
          request: args.request,
          symbols: [].concat(coins).concat(fiats),
        },
        cbk);
      }],

      // Fiat rates
      fiatRates: [
        'getFiatPrice',
        'getNetwork',
        ({getFiatPrice, getNetwork}, cbk) =>
      {
        const coin = getFiatPrice.tickers.find(({ticker}) => {
          return ticker === networks[getNetwork.network];
        });

        const rates = fiats.map(fiat => {
          const {rate} = getFiatPrice.tickers.find(n => n.ticker === fiat);

          return {fiat, unit: rateAsTokens(rate) * coin.rate};
        });

        return cbk(null, rates);
      }],

      // Parse the amount specified
      parseAmount: [
        'fiatRates',
        'getChannels',
        'getNetwork',
        ({fiatRates, getChannels, getNetwork}, cbk) =>
      {
        // Total remote balance including pending if pending fails
        const inbound = getChannels.channels.reduce((sum, chan) => {
          // Treat incoming payment as if they were still remote balance
          const inbound = chan.pending_payments.filter(n => !n.is_outgoing);

          const pending = sumOf(inbound.map(({tokens}) => tokens));

          return sum + chan.remote_balance + pending;
        },
        Number());

        // Total local balance including pending if pending fails
        const outbound = getChannels.channels.reduce((sum, chan) => {
          // Treat outgoing payment as if they were still local balance
          const outbound = chan.pending_payments.filter(n => !!is_outgoing);

          const pending = sumOf(outbound.map(({tokens}) => tokens));

          return sum + chan.local_balance + pending;
        },
        Number());

        // Variables to use in amount
        const variables = {
          inbound,
          outbound,
          eur: fiatRates.find(n => n.fiat === 'EUR').unit,
          liquidity: sumOf(getChannels.channels.map(n => n.capacity)),
          usd: fiatRates.find(n => n.fiat === 'USD').unit,
        };

        try {
          return cbk(null, parseAmount({variables, amount: args.amount}));
        } catch (err) {
          return cbk([400, 'FailedToParsePushAmount', err]);
        }
      }],

      // Push the amount to the destination
      push: ['parseAmount', ({parseAmount}, cbk) => {
        if (!parseAmount.tokens) {
          return cbk([400, 'ExpectedNonZeroAmountToPushPayment']);
        }

        args.logger.info({
          paying: formatTokens({tokens: parseAmount.tokens}).display,
          to: args.destination,
        });

        if (!!args.is_dry_run) {
          return cbk([400, 'PushPaymentDryRun']);
        }

        return probeDestination({
          destination: args.destination,
          lnd: args.lnd,
          logger: args.logger,
          is_push: true,
          is_real_payment: true,
          message: args.message,
          tokens: parseAmount.tokens,
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
