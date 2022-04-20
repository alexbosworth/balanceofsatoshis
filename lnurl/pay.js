const {createHash} = require('crypto');

const asyncAuto = require('async/auto');
const {getNodeAlias} = require('ln-sync');
const moment = require('moment');
const {returnResult} = require('asyncjs-util');
const {parsePaymentRequest} = require('ln-service');

const parseUrl = require('./parse_url');
const {pay} = require('./../network');

const errorStatus = 'ERROR';
const {isArray} = Array;
const isNumber = n => !isNaN(n);
const lowestSendableValue = 1000;
const {max} = Math;
const minMaxSendable = 1000;
const minMinSendable = 1;
const mtokensAsTokens = n => Math.floor(n / 1000);
const {parse} = JSON;
const payRequestTag = 'payRequest';
const {round} = Math;
const sha256 = n => createHash('sha256').update(n).digest().toString('hex');
const sslProtocol = 'https:';
const textPlain = 'text/plain';
const tokensAsBigUnit = tokens => (tokens / 1e8).toFixed(8);
const tokensAsMillitokens = n => n * 1000;
const utf8AsBuffer = utf8 => Buffer.from(utf8, 'utf8');

/** Pay to lnurl
 {
  ask: <Ask Function>
  avoid: [<Avoid Forwarding Through String>]
  lnd: <Authenticated LND API Object>
  lnurl: <Lnurl String>
  logger: <Winston Logger Object>
  max_fee: <Max Fee Tokens Number>
  max_paths: <Maximum Paths Number>
  out: [<Out Through Peer With Public Key Hex String>]
  request: <Request Function>
 }
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

      // Get the call back url
      getCallBackUrl: ['validate', ({}, cbk) => {
        const url = parseUrl({url: args.lnurl});

        return cbk(null, url);
      }],

      // Get accepted terms from the encoded url
      getTerms: ['getCallBackUrl', ({getCallBackUrl}, cbk) => {
        const url = getCallBackUrl;

        return args.request({url, json: true}, (err, r, json) => {
          if (!!err) {
            return cbk([503, 'FailureGettingLnUrlDataFromUrl', {err}]);
          }

          if (!json) {
            return cbk([503, 'ExpectedJsonObjectReturnedInLnurlResponse']);
          }

          if (!json.callback) {
            return cbk([503, 'ExpectedCallbackInLnurlResponseJson']);
          }

          try {
            new URL(json.callback);
          } catch (err) {
            return cbk([503, 'ExpectedValidCallbackUrlInLnurlResponseJson']);
          }

          if ((new URL(json.callback)).protocol !== sslProtocol) {
            return cbk([400, 'LnurlsThatSpecifyNonSslUrlsAreUnsupported']);
          }

          if (!isNumber(json.maxSendable)) {
            return cbk([503, 'ExpectedNumericValueForMaxSendable']);
          }

          if (!json.maxSendable) {
            return cbk([503, 'ExpectedNonZeroMaxSendableInLnurlResponse']);
          }

          if (json.maxSendable < minMaxSendable) {
            return cbk([400, 'MaxSendableValueIsLowerThanSupportedValue']);
          }

          if (!json.metadata) {
            return cbk([503, 'ExpectedLnUrlMetadataInLnurlResponse']);
          }

          try {
            parse(json.metadata);
          } catch (err) {
            return cbk([503, 'ExpectedValidMetadataInLnurlResponse']);
          }

          if (!isArray(parse(json.metadata))) {
            return cbk([503, 'ExpectedMetadataArrayInLnurlResponse', json]);
          }

          const [, description] = parse(json.metadata)
            .filter(isArray)
            .find(([entry, text]) => entry === textPlain && !!text);

          if (!description) {
            return cbk([503, 'ExpectedTextPlainEntryInLnurlResponse']);
          }

          if (!isNumber(json.minSendable)) {
            return cbk([503, 'ExpectedNumericValueForMinSendable']);
          }

          if (json.minSendable < minMinSendable) {
            return cbk([503, 'ExpectedHigherMinSendableValueInLnurlResponse']);
          }

          if (json.minSendable > json.maxSendable) {
            return cbk([503, 'ExpectedMaxSendableMoreThanMinSendable']);
          }

          if (json.tag !== payRequestTag) {
            return cbk([503, 'ExpectedPaymentRequestTagInLnurlResponse']);
          }

          return cbk(null, {
            description,
            hash: sha256(utf8AsBuffer(json.metadata)),
            max: mtokensAsTokens(json.maxSendable),
            min: mtokensAsTokens(max(lowestSendableValue, json.minSendable)),
            url: json.callback,
          });
        });
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
        const qs = {amount: askAmount};
        const {url} = getTerms;

        return args.request({url, qs, json: true}, (err, r, json) => {
          if (!!err) {
            return cbk([503, 'FailedToGetPaymentRequestFromService', {err}]);
          }

          if (!json) {
            return cbk([503, 'ServiceFailedToReturnPayReqJson']);
          }

          if (json.status === errorStatus) {
            return cbk([503, 'ServiceReturnedError', {err: json.reason}]);
          }

          if (!json.pr) {
            return cbk([503, 'ExpectedPaymentRequestFromService']);
          }

          try {
            parsePaymentRequest({request: json.pr});
          } catch (err) {
            return cbk([503, 'FailedToParseReturnedPaymentRequest', {err}]);
          }

          const request = parsePaymentRequest({request: json.pr});

          if (request.description_hash !== getTerms.hash) {
            return cbk([503, 'ServiceReturnedInvalidPaymentDescriptionHash']);
          }

          if (request.is_expired) {
            return cbk([503, 'ServiceReturnedExpiredPaymentRequest']);
          }

          if (request.mtokens !== askAmount.toString()) {
            return cbk([503, 'ServiceReturnedIncorrectInvoiceAmount']);
          }

          return cbk(null, json.pr);
        });
      }],

      // Get the destination node alias
      getAlias: ['getRequest', ({getRequest}, cbk) => {
        return getNodeAlias({
          id: parsePaymentRequest({request: getRequest}).destination,
          lnd: args.lnd,
        },
        cbk);
      }],

      // Confirm payment
      confirm: [
        'getAlias',
        'getRequest',
        'getTerms',
        ({getAlias, getRequest, getTerms}, cbk) =>
      {
        const details = parsePaymentRequest({request: getRequest});

        args.logger.info({
          amount: details.safe_tokens,
          description: getTerms.description,
          payment_request: getRequest,
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
          lnd: args.lnd,
          logger: args.logger,
          max_fee: args.max_fee,
          max_paths: args.max_paths,
          out: args.out,
          request: getRequest,
        },
        cbk);
      }],
    },
    returnResult({reject, resolve, of: 'pay'}, cbk));
  });
};
