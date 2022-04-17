const asyncAuto = require('async/auto');
const {bech32} = require('bech32');
const {createHash} = require('crypto');
const {createHmac} = require('crypto');
const {returnResult} = require('asyncjs-util');
const {signMessage} = require('ln-service');
const {ecdsaSign} = require('secp256k1');
const {publicKeyCreate} = require('secp256k1');
const {signatureExport} = require('secp256k1');

const {decode} = bech32;
const asLnurl = n => n.substring(n.startsWith('lightning:') ? 10 : 0);
const bech32CharLimit = 2000;
const bytesToHexString = (bytes) => bytes.reduce((memo, i) => memo + ('0' + i.toString(16)).slice(-2), "");
const errorStatus = 'ERROR';
const hexToUint8Array = (n) => new Uint8Array(n.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
const prefix = 'lnurl';
const lnurlAuthCanonicalPhrase = "USE THIS PHRASE TO DERIVE HASHING KEY";
const sha256 = n => createHash('sha256').update(n).digest();
const sha256hmac = (key, url) => createHmac('sha256', key).update(url).digest();
const stringToUint8Array = (n) => Uint8Array.from(n, x => x.charCodeAt(0));
const wordsAsUtf8 = n => Buffer.from(bech32.fromWords(n)).toString('utf8');

/** Authenticate using lnurl

  {
    ask: <Ask Function>
    request: <Request Function>
    lnd: <Authenticated LND API Object>
    lnurl: <Lnurl String>
    logger: <Winston Logger Object>
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.ask) {
          return cbk([400, 'ExpectedAskFunctionToAuthenticateUsingLnurl']);
        }

        if (!args.lnurl) {
          return cbk([400, 'ExpectedUrlToAuthenticateUsing']);
        }

        try {
          decode(asLnurl(args.lnurl), bech32CharLimit);
        } catch (err) {
          return cbk([400, 'FailedToDecodeLnurlToAuthenticate', {err}]);
        }

        if (decode(asLnurl(args.lnurl), bech32CharLimit).prefix !== prefix) {
          return cbk([400, 'ExpectedLnUrlPrefixToAuthenticate']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToAuthenticateUsing']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToAuthenticateUsing']);
        }

        if (!args.request) {
          return cbk([400, 'ExpectedRequestFunctionToGetLnurlAuthenticationData']);
        }

        return cbk();
      },

      // Parse lnurl
      parseLnurl: ['validate', ({}, cbk) => {
        const {words} = decode(asLnurl(args.lnurl), bech32CharLimit);
        const url = wordsAsUtf8(words);

        try {
          new URL(url);
        } catch (err) {
          return cbk([503, 'ExpectedValidCallbackUrlInDecodedLnurlForAuthentication']);
        }

        const decodeUrl = new URL(url);
        const k1 = decodeUrl.searchParams.get('k1');
        const domain = decodeUrl.hostname;

        if (!k1) {
          return cbk([503, 'ExpectedK1InDecodedLnurlForAuthentication']);
        }

        return cbk(null, {domain, k1, url});
      }],

      // Sign the Canonical Phrase
      signMessage: ['validate', ({}, cbk) => {
        return signMessage({lnd: args.lnd, message: lnurlAuthCanonicalPhrase}, cbk);
      }],

      // Derive keys and get signatures
      getSignatures: ['parseLnurl', 'signMessage', ({parseLnurl, signMessage}, cbk) => {
        const {k1} = parseLnurl; 
        const {domain} = parseLnurl;
        const {signature} = signMessage;

        const hashingKey = sha256(stringToUint8Array(signature));

        const linkingKeyPriv = sha256hmac(hashingKey, stringToUint8Array(domain));
        const linkingKeyPub = publicKeyCreate(linkingKeyPriv, true);

        const signedMessage = ecdsaSign(hexToUint8Array(k1), linkingKeyPriv);
        const signedMessageDER = signatureExport(signedMessage.signature)

        return cbk(null, {
          sig: bytesToHexString(signedMessageDER), 
          key: bytesToHexString(linkingKeyPub),
        });
      }],

      // Authenticate using lnurl
      auth: [
        'getSignatures',
        'parseLnurl',
        ({getSignatures, parseLnurl}, cbk) => {
          const {url} = parseLnurl;
          const {key} = getSignatures;
          const {sig} = getSignatures;

          const qs = {key, sig};
          return args.request({url, qs, json: true}, (err, r, json) => {
            if (!!err) {
              return cbk([503, 'FailedToGetLnurlAuthenticationData', {err}]);
            }

            if (!json) {
              return cbk([503, 'ExpectedJsonObjectReturnedInLnurlResponseForAuthentication']);
            }

            if (json.status === errorStatus) {
              return cbk([503, 'LnurlAuthenticationReturnedErr', {err: json.reason}]);
            }

            if (json.status !== 'OK') {
              return cbk([503, 'ExpectedStatusToBeOkInLnurlResponseJsonForAuthentication']);
            }

            args.logger.info({is_authenticated: true});

            return cbk();
          });
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
