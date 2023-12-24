const asyncAuto = require('async/auto');
const {getNodeAlias} = require('ln-sync');
const moment = require('moment');
const {returnResult} = require('asyncjs-util');
const {parsePaymentRequest} = require('ln-service');

const getPayRequest = require('./get_pay_request');
const getPayTerms = require('./get_pay_terms');
const parseUrl = require('./parse_url');
const {pay} = require('./../network');

const {isArray} = Array;
const isNumber = n => !isNaN(n);
const {round} = Math;
const tokensAsBigUnit = tokens => (tokens / 1e8).toFixed(8);
const tokensAsMillitokens = n => n * 1000;

/** Pay to lnurl

  {
    ask: <Ask Function>
    avoid: [<Avoid Forwarding Through String>]
    [fs]: {
      getFile: <Read File Contents Function> (path, cbk) => {}
    }
    lnd: <Authenticated LND API Object>
    lnurl: <Lnurl String>
    logger: <Winston Logger Object>
    max_fee: <Max Fee Tokens Number>
    max_paths: <Maximum Paths Number>
    out: [<Out Through Peer With Public Key Hex String>]
    request: <Request Function>
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.ask) {
          return cbk([400, 'ExpectedAskFunctionToGetPaymentRequestFromLnurl']);
        }

        if (!isArray(args.avoid)) {
          return cbk([400, 'ExpectedAvoidArrayToGetPaymentRequestFromLnurl']);
        }

        if (!args.lnurl) {
          return cbk([400, 'ExpectedUrlToGetPaymentRequestFromLnurl']);
        }

        try {
          parseUrl({url: args.lnurl});
        } catch (err) {
          return cbk([400, err.message]);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToGetPaymentRequestFromLnurl']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToGetPaymentRequestFromLnurl']);
        }

        if (!args.max_fee) {
          return cbk([400, 'ExpectedMaxFeeToGetPaymentRequestFromLnurl']);
        }

        if (!args.max_paths) {
          return cbk([400, 'ExpectedMaxPathsCountToPayViaLnurl']);
        }

        if (!isArray(args.out)) {
          return cbk([400, 'ExpectedArrayOfOutPeersToPayViaLnurl']);
        }

        if (!args.request) {
          return cbk([400, 'ExpectedRequestFunctionToGetLnurlData']);
        }

        return cbk();
      },

      // Get accepted terms from the encoded url
      getTerms: ['validate', ({}, cbk) => {
        return getPayTerms({
          request: args.request,
          url: parseUrl({url: args.lnurl}).url,
        },
        cbk);
      }],

      // Ask the user for how much they want to send
      askAmount: ['getTerms', ({getTerms}, cbk) => {
        const {max} = getTerms;
        const {min} = getTerms;

        return args.ask({
          default: getTerms.min,
          message: `Amount to pay? (min: ${min}, max: ${max})`,
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

            if (round(input) !== Number(input)) {
              return 'Fractional amounts are not supported';
            }

            if (Number(input) > max) {
              return `Service max sendable is ${max}, try a lower amount?`;
            }

            if (Number(input) < min) {
              return `Service min sendable is ${min}, try a higher amount?`;
            }

            return true;
          },
        },
        ({amount}) => cbk(null, tokensAsMillitokens(Number(amount))));
      }],

      // Get payment request
      getRequest: ['askAmount', 'getTerms', ({askAmount, getTerms}, cbk) => {
        return getPayRequest({
          hash: getTerms.hash,
          mtokens: askAmount.toString(),
          request: args.request,
          url: getTerms.url,
        },
        cbk);
      }],

      // Get the destination node alias
      getAlias: ['getRequest', ({getRequest}, cbk) => {
        return getNodeAlias({id: getRequest.destination, lnd: args.lnd}, cbk);
      }],

      // Confirm payment
      confirm: [
        'getAlias',
        'getRequest',
        'getTerms',
        ({getAlias, getRequest, getTerms}, cbk) =>
      {
        const details = parsePaymentRequest({request: getRequest.request});

        args.logger.info({
          amount: details.safe_tokens,
          description: getTerms.description,
          payment_request: getRequest.request,
          expires: moment(details.expires_at).fromNow(),
        });

        const to = `${getAlias.alias} ${getAlias.id}`.trim();

        return args.ask({
          message: `Pay ${tokensAsBigUnit(details.safe_tokens)} to ${to}?`,
          name: 'ok',
          type: 'confirm',
          default: true,
        },
        ({ok}) => {
          if (!ok) {
            return cbk([400, 'PaymentRequestPaymentCanceled']);
          }

          return cbk();
        });
      }],

      // Pay the payment request
      pay: ['confirm', 'getRequest', ({getRequest}, cbk) => {
        return pay({
          avoid: args.avoid,
          fs: args.fs,
          lnd: args.lnd,
          logger: args.logger,
          max_fee: args.max_fee,
          max_paths: args.max_paths,
          out: args.out,
          request: getRequest.request,
        },
        cbk);
      }],
    },
    returnResult({reject, resolve, of: 'pay'}, cbk));
  });
};
