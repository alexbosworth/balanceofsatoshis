const {stringify} = require('querystring');
const {URL} = require('url');

const asyncAuto = require('async/auto');
const {parsePaymentRequest} = require('ln-service');
const {payViaPaymentRequest} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const {accounts} = require('./funding');
const {getExchangeRates} = require('./../fiat');
const {probeDestination} = require('./../network');
const {shuffle} = require('./../arrays');

const baseUrl = 'https://github.com/alexbosworth/balanceofsatoshis/issues/new';
const centsPerDollar = 100;
const centsPrecision = 3;
const currency = 'USD';
const daysPerMonth = 30;
const delayMs = 1000;
const maxFee = 1337;
const maxPathfindingTimeMs = 1000 * 60 * 10;
const mtokensPerToken = BigInt(1e3);
const satsPerBtc = 1e8;
const tippinApi = 'https://api.tippin.me/v1/public/addinvoice';

/** Send some money to a worthy tippin.me receiver

  {
    [is_dry_run]: <Avoid Actually Sending Money Bool>
    lnd: <Authenticated LND gRPC API Object>
    logger: <Winston Logger Object>
    request: <Request Function>
    [to_twitter_account]: <Send Money to Twitter Account String>
    tokens: <Send Tokens Number>
  }

  @returns via cbk or Promise
  {
    [payment]: {
      proof: <Preimage Hex String>
      routing_fee: <Routing Fee Tokens Number>
      sent: <Tokens Number>
    }
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToFundDev']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToFundDev']);
        }

        if (!args.request) {
          return cbk([400, 'ExpectedRequestFunctionToFundDev']);
        }

        if (!args.tokens) {
          return cbk([400, 'ExpectedTokensToFundDev']);
        }

        return cbk();
      },

      // Get exchange rate
      getRate: ['validate', ({}, cbk) => getExchangeRates({symbols: []}, cbk)],

      // Select a recipient
      recipient: ['validate', ({}, cbk) => {
        // Exit early when a @name was specified
        if (/^@.*/.test(args.to_twitter_account)) {
          return cbk(null, args.to_twitter_account.slice('@'.length));
        }

        // Exit early when a url is specified
        if (/^https:\/\/twitter\.com\/.*/.test(args.to_twitter_account)) {
          const {pathname} = new URL(args.to_twitter_account);

          return cbk(null, pathname.slice('/'.length));
        }

        // Exit early when a username was specified
        if (!!args.to_twitter_account) {
          return cbk(null, args.to_twitter_account);
        }

        const [lucky] = shuffle({array: accounts}).shuffled;

        return cbk(null, lucky.twitter_username);
      }],

      // Request an invoice for the recipient
      getRequest: ['getRate', 'recipient', ({getRate, recipient}, cbk) => {
        const {tickers} = getRate;

        const [{rate}] = tickers;

        const fiat = args.tokens / satsPerBtc * rate / centsPerDollar;

        const monthly = (fiat * daysPerMonth).toFixed(centsPrecision);

        args.logger.info({
          will_fund: `https://twitter.com/@${recipient}`,
          amount_to_send: args.tokens,
          amount_to_send_fiat: `$${fiat.toFixed(centsPrecision)} ${currency}`,
          if_daily_monthly_amount: `$${monthly} ${currency}`,
        });

        return args.request({
          json: true,
          url: `${tippinApi}/${recipient}/${args.tokens}`,
        },
        (err, r, invoice) => {
          if (!!err) {
            return cbk([503, 'UnexpectedErrorContactingTippinMeApi', {err}]);
          }

          if (!r) {
            return cbk([503, 'UnexpectedLackOfResponseFromTippinMeApi']);
          }

          if (!!invoice && !!invoice.error) {
            return cbk([503, 'TippinMeInvoiceFailed', {err: invoice.message}]);
          }

          if (!invoice || !invoice.lnreq) {
            return cbk([503, 'UnexpectedResponseFromTippinMeApi']);
          }

          const request = invoice.lnreq;

          try {
            parsePaymentRequest({request});
          } catch (err) {
            return cbk([503, 'FailedToPraseTippinMePaymentRequest']);
          }

          if (parsePaymentRequest({request}).tokens !== args.tokens) {
            return cbk([503, 'UnexpectedTokensValueFromTippinMeRequest']);
          }

          return cbk(null, request);
        });
      }],

      // Delay execution
      delay: ['getRequest', ({}, cbk) => setTimeout(cbk, delayMs)],

      // Probe
      probe: ['delay', 'getRequest', ({getRequest}, cbk) => {
        args.logger.info({checking_route_to_send: args.tokens});

        return probeDestination({
          lnd: args.lnd,
          logger: args.logger,
          request: getRequest,
        },
        cbk);
      }],

      // Pay
      pay: ['getRequest', 'probe', ({getRequest}, cbk) => {
        if (!!args.is_dry_run) {
          return cbk();
        }

        return payViaPaymentRequest({
          lnd: args.lnd,
          max_fee: maxFee,
          pathfinding_timeout: maxPathfindingTimeMs,
          request: getRequest,
        },
        cbk);
      }],

      // Get a shortened champion URL
      championUrl: [
        'getRequest',
        'pay',
        'recipient',
        ({getRequest, pay, recipient}, cbk) =>
      {
        if (!pay) {
          return cbk();
        }

        const body = [
          `I champion https://twitter.com/${recipient}!`,
          '',
          `+${args.tokens}`,
          '',
          `${getRequest} ${pay.secret}`,
        ];

        const issueTemplate = {
          body: body.join('\n'),
          title: `Champion Funding Recipient: @${recipient}`,
        };

        return args.request({
          form: {url: `${baseUrl}?${stringify(issueTemplate)}`},
          method: 'POST',
          url: 'https://git.io',
        },
        (err, r) => {
          if (!!err) {
            args.logger.error({err});

            return cbk();
          }

          if (!r || !r.headers.location) {
            args.logger.error({err: [503, 'ExpectedChampionLocationHeader']});

            return cbk();
          }

          return cbk(null, r.headers.location);
        });
      }],

      // Final result
      result: [
        'championUrl',
        'pay',
        'recipient',
        ({championUrl, pay, recipient}, cbk) =>
      {
        if (!pay) {
          return cbk(null, {});
        }

        return cbk(null, {
          payment: {
            recipient: `https://twitter.com/${recipient}`,
            funded: args.tokens,
            routing_fee: Number(BigInt(pay.fee_mtokens) / mtokensPerToken),
            champion_this_recipient: championUrl,
          },
        });
      }],
    },
    returnResult({reject, resolve, of: 'result'}, cbk));
  });
};
