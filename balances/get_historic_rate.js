const asyncAuto = require('async/auto');
const asyncRetry = require('async/retry');
const {getPrices} = require('@alexbosworth/fiat');
const {returnResult} = require('asyncjs-util');

const {failedRequestErrors} = require('./constants');

const isFailedRequest = err => !!err && failedRequestErrors.includes(err[1]);
const retryDelaysMs = [1000, 2000];
const supportedCurrency = 'BTC';

/** Get the fiat rate of BTC at the hour of a date from a rate provider

  {
    currency: <Currency Type String>
    date: <ISO 8601 Date String>
    fiat: <Fiat Type String>
    from: <Rate Provider String>
    request: <Request Function>
  }

  @returns via cbk or Promise
  {
    cents: <Cents Per BTC Number>
  }
*/
module.exports = ({currency, date, fiat, from, request}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (currency !== supportedCurrency) {
          return cbk([400, 'UnsupportedCurrencyToGetHistoricRate']);
        }

        if (!date) {
          return cbk([400, 'ExpectedDateToGetHistoricRate']);
        }

        if (!fiat) {
          return cbk([400, 'ExpectedFiatToGetHistoricRate']);
        }

        if (!from) {
          return cbk([400, 'ExpectedRateProviderToGetHistoricRate']);
        }

        if (!request) {
          return cbk([400, 'ExpectedRequestFunctionToGetHistoricRate']);
        }

        return cbk();
      },

      // Get the price at the hour of the date, trying a failed request again
      getPrice: ['validate', ({}, cbk) => {
        return asyncRetry({
          errorFilter: isFailedRequest,
          interval: count => retryDelaysMs[count - 1],
          times: retryDelaysMs.length + 1,
        },
        cbk => getPrices({date, from, request, symbols: [fiat]}, cbk),
        cbk);
      }],

      // The rate of the fiat
      rate: ['getPrice', ({getPrice}, cbk) => {
        const [ticker] = getPrice.tickers;

        return cbk(null, {cents: ticker.rate});
      }],
    },
    returnResult({reject, resolve, of: 'rate'}, cbk));
  });
};
