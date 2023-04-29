const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const asyncRetry = require('async/retry');
const {createInvoice} = require('ln-service');
const {getChannels} = require('ln-service');
const {getChannel} = require('ln-service');
const {getIdentity} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {getNodeAlias} = require('ln-sync');
const {getPrices} = require('@alexbosworth/fiat');
const {parseAmount} = require('ln-accounting');
const {parsePaymentRequest} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {subscribeToForwardRequests} = require('ln-service');

const signPaymentRequest = require('./sign_payment_request');

const coins = ['BTC'];
const defaultFiatRateProvider = 'coinbase';
const defaultInvoiceDescription = '';
const defaultTimeoutCheckMs = 1000 * 60 * 3;
const fiats = ['EUR', 'USD'];
const hasFiat = n => /(eur|usd)/gim.test(n);
const hoursFromNow = h => new Date(Date.now() + (h * 3600000)).toISOString();
const interval = 3000;
const {isArray} = Array;
const {isInteger} = Number;
const isNumber = n => !isNaN(n);
const mtokensAsBigUnit = n => (Number(n / BigInt(1000)) / 1e8).toFixed(8);
const networks = {btc: 'BTC', btctestnet: 'BTC', btcregtest: 'BTC'};
const parseRequest = request => parsePaymentRequest({request});
const rateAsTokens = rate => 1e10 / rate;
const times = 20 * 60 * 24;
const tokensAsBigUnit = tokens => (tokens / 1e8).toFixed(8);
const uniq = arr => Array.from(new Set(arr));

/** Create an invoice for a requested amount

  {
    amount: <Invoice Amount String>
    ask: <Inquirer Function>
    [description]: <Invoice Description String>
    [expires_in]: <Invoice Expires In Hours Number>
    [is_hinting]: <Include Private Channels Bool>
    [is_selecting_hops]: <Is Selecting Hops Bool>
    [is_virtual]: <Is Using Virtual Channel for Invoice Bool>
    lnd: <Authenticated LND API Object>
    [rate_provider]: <Fiat Rate Provider String>
    request: <Request Function>
  }

  @returns via cbk or Promise
  {
    [is_settled]: <Invoice Was Paid Bool>
    [request]: <BOLT 11 Payment Request String>
    [tokens]: <Invoice Amount Number>
  }
 */
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.amount) {
          return cbk([400, 'ExpectedInvoiceAmountToCreateNewInvoice']);
        }

        if (isNumber(args.amount) && !isInteger(Number(args.amount))) {
          return cbk([400, 'ExpectedIntegerAmountToInvoice']);
        }

        if (!args.ask) {
          return cbk([400, 'ExpectedAskFunctionToCreateNewInvoice']);
        }

        if (args.expires_in !== undefined && !args.expires_in) {
          return cbk([400, 'ExpectedNonZeroExpirationTimeForNewInvoice']);
        }

        if (!!args.is_hinting && !!args.is_selecting_hops) {
          return cbk([400, 'CannotUseDefaultHintsAndAlsoSelectHints']);
        }

        if (!!args.is_virtual && !!args.is_hinting) {
          return cbk([400, 'UsingHopHintsIsUnsupportedWithVirtualChannels']);
        }

        if (!!args.is_virtual && !!args.is_selecting_hops) {
          return cbk([400, 'ChoosingHopHintsUnsupportedWithVirtualChannels']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToCreateNewInvoice']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedWinstonLoggerObjectToCreateNewInvoice']);
        }

        if (!args.request) {
          return cbk([400, 'ExpectedRequestFunctionToCreateNewInvoice']);
        }

        return cbk();
      },

      // Calculate invoice expiry date
      expiresAt: ['validate', ({}, cbk) => {
        // Exit early if expiry is not defined
        if (!args.expires_in) {
          return cbk();
        }

        return cbk(null, hoursFromNow(args.expires_in));
      }],

      // Get the current price of BTC in USD/EUR
      getFiatPrice: ['validate', ({}, cbk) => {
        // Exit early when no fiat is referenced
        if (!hasFiat(args.amount)) {
          return cbk();
        }

        return getPrices({
          from: args.rate_provider || defaultFiatRateProvider,
          request: args.request,
          symbols: [].concat(fiats),
        },
        cbk);
      }],

      // Get channels to allow for selecting individual hop hints
      getChannels: ['validate', ({}, cbk) => {
        // Exit early when not selecting hop hints
        if (!args.is_selecting_hops) {
          return cbk();
        }

        return getChannels({
          is_active: true,
          is_private: true,
          lnd: args.lnd,
        },
        cbk);
      }],

      // Get node aliases for channels for selecting hop hints
      getAliases: ['getChannels', ({getChannels}, cbk) => {
        // Exit early when not selecting hop hints
        if (!args.is_selecting_hops) {
          return cbk();
        }

        const ids = uniq(getChannels.channels.map(n => n.partner_public_key));

        return asyncMap(ids, (id, cbk) => {
          return getNodeAlias({id, lnd: args.lnd}, cbk);
        },
        cbk);
      }],

      // Get network name
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd: args.lnd}, cbk)],

      // Get wallet info
      getId: ['validate', ({}, cbk) => getIdentity({lnd: args.lnd}, cbk)],

      // Fiat rates
      rates: [
        'getFiatPrice',
        'getNetwork',
        ({getFiatPrice, getNetwork}, cbk) =>
      {
        // Exit early when there is no fiat
        if (!getFiatPrice) {
          return cbk();
        }

        if (!networks[getNetwork.network]) {
          return cbk([400, 'UnsupportedNetworkForFiatPriceConversion']);
        }

        const rates = fiats.map(fiat => {
          const {rate} = getFiatPrice.tickers.find(n => n.ticker === fiat);

          return {fiat, unit: rateAsTokens(rate)};
        });

        return cbk(null, rates);
      }],

      // Parse the amount
      parseAmount: ['rates', ({rates}, cbk) => {
        const eur = !!rates ? rates.find(n => n.fiat === 'EUR') : null;
        const usd = !!rates ? rates.find(n => n.fiat === 'USD') : null;

        // Variables to use in amount
        const variables = {
          eur: !!eur ? eur.unit : undefined,
          usd: !!usd ? usd.unit : undefined,
        };

        try {
          const {tokens} = parseAmount({variables, amount: args.amount});

          return cbk(null, {tokens});
        } catch (err) {
          return cbk([400, 'FailedToParseAmount', {err}]);
        }
      }],

      // Select hop hint channels
      selectChannels: [
        'getAliases',
        'getChannels',
        'parseAmount',
        ({getAliases, getChannels}, cbk) =>
      {
        // Exit early if not selecting channels
        if (!args.is_selecting_hops) {
          return cbk();
        }

        // Make sure there are some channels to select
        if (!getChannels.channels.length) {
          return cbk([400, 'NoRelevantChannelsToSelectAsHints']);
        }

        return args.ask({
          choices: getChannels.channels.map(channel => {
            const node = getAliases.find(({id}) => {
              return id === channel.partner_public_key
            });

            const value = channel.id;
            const inbound = `in: ${tokensAsBigUnit(channel.remote_balance)}`;
            const outbound = `out: ${tokensAsBigUnit(channel.local_balance)}`;

            return {
              value,
              name: `${value} ${node.alias}: ${inbound} | ${outbound}.`,
            };
          }),
          loop: false,
          message: `Channels to include as hints in the invoice?`,
          name: 'id',
          type: 'checkbox',
          validate: input => !!input.length,
        },
        ({id}) => cbk(null, id));
      }],

      // Get the policies of selected channels
      getPolicies: ['selectChannels', ({selectChannels}, cbk) => {
        return asyncMap(selectChannels, (channel, cbk) => {
          return getChannel({id: channel, lnd: args.lnd}, (err, res) => {
            // Exit early when the channel isn't found
            if (isArray(err) && err.slice().shift() === 404) {
              return cbk();
            }

            if (!!err) {
              return cbk(err);
            }

            // Exit early when the channel policies are not defined
            if (!!res.policies.find(n => n.cltv_delta === undefined)) {
              return cbk();
            }

            return cbk(null, res);
          });
        },
        cbk);
      }],

      // Create the invoice in the LND database
      addInvoice: [
        'expiresAt',
        'getPolicies',
        'parseAmount',
        ({expiresAt, parseAmount}, cbk) => {
        // Exit with error when no amount is given
        if (!!args.is_virtual && !parseAmount.tokens) {
          return cbk([400, 'ExpectedNonZeroInvoiceForVirtualChannel']);
        }

        return createInvoice({
          description: args.description || defaultInvoiceDescription,
          expires_at: expiresAt,
          is_including_private_channels: args.is_hinting || undefined,
          lnd: args.lnd,
          tokens: parseAmount.tokens,
        },
        cbk);
      }],

      // Intercept virtual invoice forwards
      interceptVirtualInvoice: ['addInvoice', ({addInvoice}, cbk) => {
        // Exit early when not intercepting the virtual forward
        if (!args.is_virtual) {
          return cbk();
        }

        args.logger.info({listening_for_virtual_channel_payment: true});

        const expiry = new Date(parseRequest(addInvoice.request).expires_at);
        let interval;
        const sub = subscribeToForwardRequests({lnd: args.lnd});

        // Stop listening for the HTLC when the invoice expires
        interval = setInterval(() => {
          // Exit early when there is still time left until the expiry date
          if (new Date() < expiry) {
            return;
          }

          clearInterval(interval);

          sub.removeAllListeners();

          return cbk([408, 'TimedOutWaitingForPayment']);
        },
        defaultTimeoutCheckMs);

        const finished = (err, res) => {
          clearInterval(interval);

          sub.removeAllListeners();

          return cbk(err, res);
        };

        // Listen for an error on the requests subscription
        sub.on('error', err => {
          args.logger.error({err});

          return finished(err);
        });

        // Listen for a payment to the virtual channel invoice
        sub.on('forward_request', async forward => {
          // Exit early and accept requests that are not for this invoice
          if (forward.hash !== addInvoice.id) {
            return forward.accept({});
          }

          // Reject too small amounts
          if (BigInt(forward.mtokens) < BigInt(addInvoice.mtokens)) {
            return forward.reject({});
          }

          args.logger.info({accepting_payment: true});

          forward.settle({secret: addInvoice.secret});

          // Wait until the payment is no longer pending
          await asyncRetry({interval, times}, async () => {
            const {channels} = await getChannels({lnd: args.lnd});

            const channel = channels.find(n => n.id === forward.in_channel);

            if (!channel) {
              throw new Error('FailedToFindForwardChannel');
            }

            const pending = channel.pending_payments.find(({payment}) => {
              return payment === forward.in_channel;
            });

            if (!!pending) {
              throw new Error('PaymentIsStillPending');
            }

            return;
          });

          const got = BigInt(forward.mtokens) + BigInt(forward.fee_mtokens);

          args.logger.info({received: mtokensAsBigUnit(got)});

          return finished();
        });

        return;
      }],

      // Create the final signed public payment request
      publicRequest: [
        'addInvoice',
        'expiresAt',
        'getId',
        'getNetwork',
        'getPolicies',
        'parseAmount',
        ({
          addInvoice,
          expiresAt,
          getId,
          getNetwork,
          getPolicies,
          parseAmount,
        },
        cbk) =>
      {
        // Exit early if not using custom hop hints
        if (!args.is_selecting_hops && !args.is_virtual) {
          return cbk(null, {
            request: addInvoice.request,
            tokens: addInvoice.tokens,
          });
        }

        return signPaymentRequest({
          channels: getPolicies,
          cltv_delta: parseRequest(addInvoice.request).cltv_delta,
          description: args.description || defaultInvoiceDescription,
          destination: getId.public_key,
          expires_at: expiresAt,
          features: parseRequest(addInvoice.request).features,
          id: addInvoice.id,
          is_virtual: args.is_virtual,
          lnd: args.lnd,
          network: getNetwork.bitcoinjs,
          payment: addInvoice.payment,
          tokens: parseAmount.tokens,
          virtual_fee_rate: args.virtual_fee_rate,
        },
        cbk);
      }],

      // Log the virtual channel payment request
      logRequest: ['publicRequest', ({publicRequest}, cbk) => {
        // Exit early when not using a virtual channel
        if (!args.is_virtual) {
          return cbk(null, publicRequest);
        }

        args.logger.info({
          request: publicRequest.request,
          tokens: parseRequest(publicRequest.request).tokens,
          virtual_fee_rate: args.virtual_fee_rate || undefined,
        });

        return cbk(null, {is_settled: true});
      }],
    },
    returnResult({reject, resolve, of: 'logRequest'}, cbk));
  });
};
