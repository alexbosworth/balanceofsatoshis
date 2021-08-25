const asyncAuto = require('async/auto');
const {decodePaymentRequest} = require('ln-service');
const {getHeight} = require('ln-service');
const moment = require('moment');
const {payViaPaymentRequest} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const {authenticatedLnd} = require('./../lnd');
const {decryptPayload} = require('./../encryption');
const {exchanges} = require('./market');
const {pairs} = require('./market');

const api = 'https://api.suredbits.com/historical/v0/';
const base64ToHex = base64 => Buffer.from(base64, 'base64').toString('hex');
const daysCount = 80;
const defaultMaxFee = 5;
const {isArray} = Array;
const maxCltvDelta = 144 * 30;
const {parse} = JSON;
const pathfindingTimeoutMs = 1000 * 60 * 5;
const titleCase = str => `${str.charAt(0).toUpperCase()}${str.slice(1)}`;

/** Get historic exchange rates

  {
    exchange: <Exchange String>
    [fee]: <Desired Maximum Fee Tokens Number>
    [node]: <Saved Node Name String>
    pair: <Pair String>
    request: <Request Function>
  }

  @returns via cbk or Promise
  {
    description: <Price Range Description String>
    prices: [<Price on Day String>]
  }
*/
module.exports = ({exchange, fee, node, pair, request}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Get lnd
      getLnd: cbk => authenticatedLnd({node}, cbk),

      // Check arguments
      validate: cbk => {
        if (!exchanges.find(n => n === exchange)) {
          return cbk([400, 'ExpectedKnownExchangeToGetPriceData']);
        }

        if (fee !== undefined && !fee) {
          return cbk([400, 'ExpectedNonZeroMaxFeeToGetPriceData']);
        }

        if (!pairs[pair]) {
          return cbk([400, 'ExpectedKnownPairToGetPriceData']);
        }

        if (!pairs[pair].find(n => n === exchange)) {
          return cbk([400, 'UnsupportedExchange', {supported: pairs[pair]}]);
        }

        return cbk();
      },

      // Get price data
      getPrices: ['validate', ({}, cbk) => {
        const year = moment().format('Y');

        return request({
          json: true,
          url: `${api}${exchange}/${pair.toUpperCase()}/${year}/daily`,
        },
        (err, r, json) => {
          if (!!err) {
            return cbk([503, 'UnexpectedErrorGettingHistoricalPrices', {err}]);
          }

          if (!r) {
            return cbk([503, 'ExpectedResponseWhenGettingHistoricalPrices']);
          }

          if (r.statusCode !== 200) {
            return cbk([503, 'UnexpectedStatusCodeGettingHistoricalPrices'])
          }

          if (!json) {
            return cbk([503, 'ExpectedResponseDataFromHistoricalPriceApi']);
          }

          if (!json.encryptedData) {
            return cbk([503, 'ExpectedEncryptedHistoricalPriceData']);
          }

          if (!json.invoice) {
            return cbk([503, 'ExpectedPaymentRequestForHistoricalPriceData']);
          }

          try {
            return cbk(null, {
              encrypted: base64ToHex(json.encryptedData),
              request: json.invoice,
            });
          } catch (err) {
            return cbk([503, 'UnexpectedDataFromHistoricalPriceApi', {err}]);
          }
        });
      }],

      // Decode request
      decodedRequest: ['getLnd', 'getPrices', ({getLnd, getPrices}, cbk) => {
        return decodePaymentRequest({
          lnd: getLnd.lnd,
          request: getPrices.request,
        },
        cbk);
      }],

      // Get height
      getHeight: ['decodedRequest', 'getLnd', ({getLnd}, cbk) => {
        return getHeight({lnd: getLnd.lnd}, cbk);
      }],

      // Purchase preimage needed to decrypt price data
      payInvoice: [
        'decodedRequest',
        'getHeight',
        'getLnd',
        'getPrices',
        ({decodedRequest, getHeight, getLnd, getPrices}, cbk) =>
      {
        const {tokens} = decodedRequest;

        // Check that the payment request doesn't require too many tokens
        if (tokens > (fee || defaultMaxFee)) {
          return cbk([400, 'MaxFeePriceFetchFeeTooLow', {needed_fee: tokens}]);
        }

        return payViaPaymentRequest({
          lnd: getLnd.lnd,
          max_fee: (fee || defaultMaxFee) - tokens,
          max_timeout_height: getHeight.current_block_height + maxCltvDelta,
          pathfinding_timeout: pathfindingTimeoutMs,
          request: getPrices.request,
        },
        cbk);
      }],

      // Decrypt price data
      prices: ['getPrices', 'payInvoice', ({getPrices, payInvoice}, cbk) => {
        const {encrypted} = getPrices;
        const {secret} = payInvoice;

        try {
          const {payload} = decryptPayload({encrypted, secret});

          if (!isArray(parse(payload)) || !parse(payload).length) {
            return cbk([503, 'ExpectedArrayOfPricesInPayload']);
          }

          const prices = parse(payload).slice(-daysCount);

          if (!!prices.find(n => n.pair !== pair.toUpperCase())) {
            return cbk([503, 'ExpectedPriceForSpecifiedHistoricPair']);
          }

          if (!!prices.find(n => !n.price)) {
            return cbk([503, 'ExpectedPriceForHistoricPriceQuote']);
          }

          if (!!prices.find(n => !n.timestamp)) {
            return cbk([503, 'ExpectedTimestampForHistoricPriceQuote']);
          }

          const [end] = prices.slice().reverse();
          const [start] = prices;

          const day0 = `${moment(start.timestamp).format('L')}`;
          const fin = `${moment(end.timestamp).format('L')}`;
          const last = `Last Price: ${end.price}`
          const market = `${titleCase(exchange)} ${start.pair}`;

          return cbk(null, {
            description: `${market} from ${day0} to ${fin}. ${last}.`,
            prices: prices.map(({price}) => price),
          });
        } catch (err) {
          return cbk([503, 'FailedToDecryptHistoricPricesData', {err}]);
        }
      }],
    },
    returnResult({reject, resolve, of: 'prices'}, cbk));
  });
};
