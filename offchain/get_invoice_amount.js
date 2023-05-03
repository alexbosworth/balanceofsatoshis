const asyncAuto = require('async/auto');
const {getPrices} = require('@alexbosworth/fiat');
const {parseAmount} = require('ln-accounting');
const {returnResult} = require('asyncjs-util');

const defaultFiatRateProvider = 'coinbase';
const fiats = ['EUR', 'USD'];
const hasFiat = n => /(eur|usd)/gim.test(n);
const networks = {btc: 'BTC', btctestnet: 'BTC', btcregtest: 'BTC'};
const rateAsTokens = rate => 1e10 / rate;

/** Get an amount to invoice

  {
    amount: <Invoice Amount String>
    lnd: <Authenticated LND API Object>
    [provider]: <Fiat Rate Provider String>
    request: <Request Function>
  }

  @returns via cbk or Promise
  {
    tokens: <Invoice Tokens Number>
  }
*/
module.exports = ({amount, network, provider, request}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!amount) {
          return cbk([400, 'ExpectedAmountValueToGetInvoiceAmount']);
        }

        if (!network) {
          return cbk([400, 'ExpectedNetworkNameToGetInvoiceAmount']);
        }

        if (!request) {
          return cbk([400, 'ExpectedRequestFunctionToGetInvoicePrice']);
        }

        return cbk();
      },

      // Get the current price of BTC in USD/EUR
      getFiatPrice: ['validate', ({}, cbk) => {
        // Exit early when no fiat is referenced
        if (!hasFiat(amount)) {
          return cbk();
        }

        return getPrices({
          request,
          from: provider || defaultFiatRateProvider,
          symbols: [].concat(fiats),
        },
        cbk);
      }],

      // Fiat rates
      rates: ['getFiatPrice', ({getFiatPrice}, cbk) => {
        // Exit early when there is no fiat
        if (!getFiatPrice) {
          return cbk();
        }

        if (!networks[network]) {
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
          return cbk(null, {tokens: parseAmount({amount, variables}).tokens});
        } catch (err) {
          return cbk([400, 'FailedToParseAmount', {err}]);
        }
      }],
    },
    returnResult({reject, resolve, of: 'parseAmount'}, cbk));
  });
};
