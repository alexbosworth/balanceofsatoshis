const asyncAuto = require('async/auto');
const {bech32} = require('bech32');
const {addPeer} = require('ln-service');
const {getPeers} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {isIP} = require('net');
const {returnResult} = require('asyncjs-util');

const {decode} = bech32;
const asLnurl = n => n.substring(n.startsWith('lightning:') ? 10 : 0);
const bech32CharLimit = 2000;
const channelTypes = ['Public', 'Private'];
const defaultType = 'Public';
const errorStatus = 'ERROR';
const isClear = n => !!n && !!isIP(n.split(':')[0]);
const isOnion = n => n => !!n && /onion/.test(n);
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const okStatus = 'OK';
const parseUri = n => n.split('@');
const prefix = 'lnurl';
const sslProtocol = 'https:';
const tag = 'channelRequest';
const wordsAsUtf8 = n => Buffer.from(bech32.fromWords(n)).toString('utf8');

/** Request inbound channel from lnurl

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
          return cbk([400, 'ExpectedAskFunctionToRequestChannelFromLnurl']);
        }

        if (!args.lnurl) {
          return cbk([400, 'ExpectedUrlToRequestChannelFromLnurl']);
        }

        try {
          decode(asLnurl(args.lnurl), bech32CharLimit);
        } catch (err) {
          return cbk([400, 'FailedToDecodeLnurlToRequestChannel', {err}]);
        }

        if (decode(asLnurl(args.lnurl), bech32CharLimit).prefix !== prefix) {
          return cbk([400, 'ExpectedLnUrlPrefixToRequestChannel']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToRequestChannelFromLnurl']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToRequestChannelFromLnurl']);
        }

        if (!args.request) {
          return cbk([400, 'ExpectedRequestFunctionToGetLnurlRequestChannelData']);
        }

        return cbk();
      },

      // Get identity public key
      getWalletInfo: ['validate', ({}, cbk) => {
        return getWalletInfo({lnd: args.lnd}, cbk);
      }],

      // Get accepted terms from the encoded url
      getTerms: ['validate', ({}, cbk) => {
        const {words} = decode(asLnurl(args.lnurl), bech32CharLimit);

        const url = wordsAsUtf8(words);

        return args.request({url, json: true}, (err, r, json) => {
          if (!!err) {
            return cbk([503, 'FailureGettingLnUrlDataFromUrl', {err}]);
          }

          if (!json) {
            return cbk([503, 'ExpectedJsonObjectReturnedInLnurlResponse']);
          }

          if (json.status === errorStatus) {
            return cbk([503, 'LnurlChannelRequestReturnedErr', {err: json.reason}]);
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

          if (!json.k1) {
            return cbk([503, 'ExpectedK1InLnurlResponseJson']);
          }

          if (!json.tag) {
            return cbk([503, 'ExpectedTagInLnurlResponseJson']);
          }

          if (json.tag !== tag) {
            return cbk([503, 'ExpectedTagToBeChannelRequestInLnurlResponse']);
          }

          if (!json.uri) {
            return cbk([503, 'ExpectedUriInLnurlResponseJson']);
          }

          const [pubkey, socket] = parseUri(json.uri);

          if (!isPublicKey(pubkey)) {
            return cbk([503, 'ExpectedValidPublicKeyInLnurlResponseJson']);
          }

          if (!isOnion(socket) && !isClear(socket)) {
            return cbk([503, 'ExpectedValidOnionOrClearSocketInLnurlResponseJson']);
          }

          return cbk(null, {
            k1: json.k1,
            uri: json.uri,
            url: json.callback,
          });
        });
      }],

      // Get peers
      getPeers: ['getTerms', 'validate', ({}, cbk) => {
          return getPeers({lnd: args.lnd}, (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            return cbk(null, res);
          });
      }],

      // Connect to peer
      connect: ['getPeers', 'getTerms', ({getPeers, getTerms}, cbk) => {
        const {uri} = getTerms;
        const [pubkey, socket] = parseUri(uri);
        const {peers} = getPeers;
        
        if (!peers.find(n => n.public_key === pubkey)) {
          args.logger.info({connecting_to_peer: pubkey});
          
          return addPeer({lnd: args.lnd, socket, public_key: pubkey}, cbk);
        }
        
        return cbk();
      }],

      //Ask channel type
      askChannelType: ['getTerms', 'connect', ({getTerms}, cbk) => {
        return args.ask({
          choices: channelTypes,
          default: defaultType,
          message: 'Channel type?',
          name: 'type',
          type: 'list',
          validate: input => {
            if (!input) {
              return false;
            }

            return true;
          }
        },
        ({type}) => {
          if (type === defaultType) {
            return cbk(null, true);
          }

          return cbk(null, false);
        })
      }],

      // Confirm
      ok: ['askChannelType', ({}, cbk) => {
        return args.ask({
          default: true,
          message: `Confirm inbound channel request?`,
          name: 'ok',
          type: 'confirm',
        },
        ({ok}) => cbk(null, ok));
      }],

      // Request inbound channel
      channel: [
        'askChannelType', 
        'getTerms', 
        'getWalletInfo', 
        'ok', 
        ({
          askChannelType, 
          getTerms, 
          getWalletInfo, 
          ok
        }, cbk) => 
      {
        // Exit early if user decides to cancel
        if (!ok) {
          return cbk();
        }

        const {k1} = getTerms;
        const {url} = getTerms;
        const qs = {k1, private: !!askChannelType ? '0' : '1', remoteid: getWalletInfo.public_key};

        return args.request({url, qs, json: true}, (err, r, json) => {
          if (!!err) {
            return cbk([503, 'FailureRequestingInboundChannelFromLnurl', {err}]);
          }

          if (!json) {
            return cbk([503, 'ExpectedJsonObjectReturnedInChannelRequestResponse']);
          }

          if (json.status === errorStatus) {
            return cbk([503, 'ChannelRequestReturnedErr', {err: json.reason}]);
          }

          if (json.status !== okStatus) {
            return cbk([503, 'ExpectedOkStatusInChannelRequestResponse']);
          }

          args.logger.info({channel_open_request_sent: true});

          return cbk();
        });
      }],

      // Cancel channel request
      cancel: [
        'channel',
        'getTerms',
        'getWalletInfo',
        'ok',
        ({
          channel,
          getTerms,
          getWalletInfo,
          ok,
        }, cbk) => 
      {
        // Exit early if user proceeds
        if (!!ok) {
          return cbk();
        }

        const {k1} = getTerms;
        const {url} = getTerms;
        const qs = {cancel: '1', k1, remoteid: getWalletInfo.public_key};

        return args.request({url, qs, json: true}, (err, r, json) => {
          if (!!err) {
            return cbk([503, 'FailureCancellingInboundChannelFromLnurl', {err}]);
          }

          if (!json) {
            return cbk([503, 'ExpectedJsonObjectReturnedInCancelChannelRequestResponse']);
          }

          if (json.status === errorStatus) {
            return cbk([503, 'ChannelRequestReturnedErr', {err: json.reason}]);
          }

          if (json.status !== okStatus) {
            return cbk([503, 'ExpectedOkStatusInCancelChannelRequestResponse']);
          }

          args.logger.info({channel_open_request_cancelled: true});

          return cbk();
        });
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
