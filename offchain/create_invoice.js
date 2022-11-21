const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
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

const signPaymentRequest = require('./sign_payment_request');
const signGhostPaymentRequest = require('./sign_ghost_payment_request');

const coins = ['BTC'];
const defaultFiatRateProvider = 'coinbase';
const defaultInvoiceDescription = 'RequestForPayment';
const fiats = ['EUR', 'USD'];
const hasFiat = n => /(eur|usd)/gim.test(n);
const {isArray} = Array;
const {isInteger} = Number;
const isNumber = n => !isNaN(n);
const networks = {btc: 'BTC', btctestnet: 'BTC', btcregtest: 'BTC'};
const parseRequest = request => parsePaymentRequest({request});
const rateAsTokens = rate => 1e10 / rate;
const tokensAsBigUnit = tokens => (tokens / 1e8).toFixed(8);
const uniq = arr => Array.from(new Set(arr));

/** Create an invoice for a requested amount

  {
    amount: <Invoice Amount String>
    ask: <Inquirer Function>
    [description]: <Invoice Description String>
    [is_hinting]: <Include Private Channels Bool>
    [is_ghost_invoice]: <Is Ghost Invoice Bool>
    [is_selecting_hops]: <Is Selecting Hops Bool>
    lnd: <Authenticated LND API Object>
    [rate_provider]: <Fiat Rate Provider String>
    request: <Request Function>
  }

  @returns via cbk or Promise
  {
    request: <BOLT 11 Payment Request String>
    tokens: <Invoice Amount Number>
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

        if (!!args.is_hinting && !!args.is_selecting_hops) {
          return cbk([400, 'CannotUseDefaultHintsAndAlsoSelectHints']);
        }

        if (!!args.is_ghost_invoice && (!!args.is_hinting || !!args.is_selecting_hops)) {
          return cbk([400, 'CannotSelectHopsOrAddHintsForGhostInvoices']);
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
      getIdentity: ['validate', ({}, cbk) => getIdentity({lnd: args.lnd}, cbk)],

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
      addInvoice: ['getPolicies', 'parseAmount', ({parseAmount}, cbk) => {
        return createInvoice({
          description: args.description || defaultInvoiceDescription,
          is_including_private_channels: args.is_hinting || undefined,
          lnd: args.lnd,
          tokens: parseAmount.tokens,
        },
        cbk);
      }],

      // Create the final signed public payment request
      publicRequest: [
        'addInvoice',
        'getIdentity',
        'getNetwork',
        'getPolicies',
        'parseAmount',
        ({
          addInvoice,
          getIdentity,
          getNetwork,
          getPolicies,
          parseAmount,
        },
        cbk) =>
      {
        if (!!args.is_ghost_invoice) {
          return signGhostPaymentRequest({
            channels: getPolicies,
            cltv_delta: parseRequest(addInvoice.request).cltv_delta,
            description: args.description || defaultInvoiceDescription,
            destination: getIdentity.public_key,
            features: parseRequest(addInvoice.request).features,
            id: addInvoice.id,
            lnd: args.lnd,
            logger: args.logger,
            network: getNetwork.bitcoinjs,
            payment: addInvoice.payment,
            secret: addInvoice.secret,
            tokens: parseAmount.tokens,
          },
          cbk);
        }

        // Exit early if not selecting custom hop hints
        if (!args.is_selecting_hops) {
          return cbk(null, {
            request: addInvoice.request,
            tokens: addInvoice.tokens,
          });
        }

        return signPaymentRequest({
          channels: getPolicies,
          cltv_delta: parseRequest(addInvoice.request).cltv_delta,
          description: args.description || defaultInvoiceDescription,
          destination: getIdentity.public_key,
          features: parseRequest(addInvoice.request).features,
          id: addInvoice.id,
          lnd: args.lnd,
          network: getNetwork.bitcoinjs,
          payment: addInvoice.payment,
          tokens: parseAmount.tokens,
        },
        cbk);
      }],
    },
    returnResult({reject, resolve, of: 'publicRequest'}, cbk));
  });
};
