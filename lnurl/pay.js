const asyncAuto = require('async/auto');
const {bech32} = require('bech32');
const {returnResult} = require('asyncjs-util');
const {parsePaymentRequest} = require('ln-service');
const pay = require('./../network/pay');

const encodeQs = qs => !qs ? '' : '?' + qs;
const defaultMaxPaths = 1;
const isNumber = n => !isNaN(n);
const limit = 200;
const toMilliSats = n => (Number(n) * 1000);
const toSatoshis = n => (Number(n)/1000);

/** Pay to lnurl
 {
  ask: <AskFunction>
  fetch: <FetchFunction>
  lnd: <Authenticated LND API Object>
  lnurl: <Lnurl String>
  logger: <Winston Logger Object>
  max_fee: <Max Fee Tokens Number>
 }
*/
module.exports = ({ask, fetch, lnd, lnurl, logger, max_fee}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!ask) {
          return cbk([400, 'ExpectedAskFunctionToGetPaymentRequestFromLnurl']);
        }

        if (!fetch) {
          return cbk([400, 'ExpectedFetchToGetPaymentRequestFromLnurl']);
        }

        if (!lnurl) {
          return cbk([400, 'ExpectedUrlToGetPaymentRequestFromLnurl']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndToGetPaymentRequestFromLnurl']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedWinstonLoggerToGetPaymentRequestFromLnurl']);
        }

        if (!max_fee) {
          return cbk([400, 'ExpectedMaxFeeToGetPaymentRequestFromLnurl']);
        }

        return cbk();
      },

      // Parse lnurl
      parseLnurl: ['validate', ({}, cbk) => {
        try {
          const decoded = bech32.decode(lnurl, limit);
          const url = Buffer.from(bech32.fromWords(decoded.words)).toString('utf8');

          return cbk(null, {url});
        } catch (err) {
          return cbk([400, 'ErrorDecodingLnurl', {err}]);
        }
      }],

      // Get callback url
      getData: ['parseLnurl', async ({parseLnurl}) => {
        try {
          const url = parseLnurl.url;
          const response = await fetch(url);
          const data = await response.json();

          return {data};
        } catch (err) {
          throw new Error('ErrorGettingCallBackUrlFromLnurl', {err});
        }
      }],

      // Get for amount
      ask: ['getData', ({getData}, cbk) => {
        const max = toSatoshis(getData.data.maxSendable);
        const min = toSatoshis(getData.data.minSendable);

        return ask({
          message: `Amount to pay in satoshis? (max: ${max}, min: ${min})`,
          name: 'amount',
          type: 'input',
          validate: input => {
            if (!input) {
              return false;
            }

            // The amount should be numeric in sats
            if (!isNumber(input)) {
              return false;
            }

            // The amount should be within the limits
            if (input > max || input < min) {
              return false;
            }

            return true;
          },
        },
        ({amount}) => {
          if (!amount) {
            return cbk([400, 'ExpectedAmountToGetPaymentRequestFromLnurl']);
          }

          return cbk(null, {amount});
        });
      }],

      // Get payment request
      getPaymentRequest: ['ask', 'getData', async ({ask, getData}) => {
        const amount = toMilliSats(ask.amount);

        try {
          const encodeString = `amount=${amount}`;
          const url = getData.data.callback + encodeQs(encodeString);

          const response = await fetch(url);
          const data = await response.json();

          return {request: data.pr};
        } catch (err) {
          throw new Error('ErrorGettingPaymentRequestFromLnurl', {err});
        }
      }],

      // Confirm to pay
      confirm: ['getPaymentRequest', ({getPaymentRequest}, cbk) => {
        try {
          const request = getPaymentRequest.request;
          const parsedRequest = parsePaymentRequest({request});

          logger.info({
            request,
            tokens: parsedRequest.tokens,
            expiry: parsedRequest.expires_at,
          });
        } catch (err) {
          return cbk([400, 'ExpectedValidPaymentRequestToPay', {err}]);
        }

        return ask({
          message: `Confirm to pay?`,
          name: 'confirm',
          type: 'confirm',
          default: true,
        },
        ({confirm}) => {
          if (!confirm) {
            return cbk([400, 'CancelledPayingPaymentRequest']);
          }

          return cbk();
        });
      }],

      // Pay the payment request
      pay: ['confirm', 'getPaymentRequest', ({getPaymentRequest}, cbk) => {
        const request = getPaymentRequest.request;
        return pay({
          lnd,
          logger,
          max_fee,
          request,
          avoid: [],
          max_paths: defaultMaxPaths,
          out: [],
        },
        cbk);
      }],
    },
    returnResult({reject, resolve, of: 'pay'}, cbk));
  });
};
