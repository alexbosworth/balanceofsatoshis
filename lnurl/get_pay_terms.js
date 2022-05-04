const {createHash} = require('crypto');

const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const {isArray} = Array;
const isNumber = n => !isNaN(n);
const lowestSendableValue = 1000;
const {max} = Math;
const minMaxSendable = 1000;
const minMinSendable = 1;
const mtokensAsTokens = n => Math.floor(n / 1000);
const {parse} = JSON;
const payRequestTag = 'payRequest';
const sha256 = n => createHash('sha256').update(n).digest().toString('hex');
const sslProtocol = 'https:';
const textPlain = 'text/plain';
const utf8AsBuffer = utf8 => Buffer.from(utf8, 'utf8');

/** Get payment terms

  {
    request: <Request Function>
    url: <URL String>
  }

  @returns via cbk or Promise
  {
    description: <Payment Description String>
    hash: <Expected Description Hash Hex String>
    max: <Maximum Tokens Number>
    min: <Minimum Tokens Number>
    url: <Callback URL String>
  }
*/
module.exports = ({request, url}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!request) {
          return cbk([400, 'ExpectedRequestFunctionToGetPayTerms']);
        }

        if (!url) {
          return cbk([400, 'ExpectedUrlToGetPayTerms']);
        }

        return cbk();
      },

      // Get payment terms
      getTerms: ['validate', ({}, cbk) => {
        return request({url, json: true}, (err, r, json) => {
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
    },
    returnResult({reject, resolve, of: 'getTerms'}, cbk));
  });
};
