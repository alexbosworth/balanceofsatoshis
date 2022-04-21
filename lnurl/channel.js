const {isIP} = require('net');

const asyncAuto = require('async/auto');
const {bech32} = require('bech32');
const {addPeer} = require('ln-service');
const {getIdentity} = require('ln-service');
const {getNodeAlias} = require('ln-sync');
const {getPeers} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const asLnurl = n => n.substring(n.startsWith('lightning:') ? 10 : 0);
const bech32CharLimit = 2000;
const {decode} = bech32;
const errorStatus = 'ERROR';
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const okStatus = 'OK';
const parseUri = n => n.split('@');
const prefix = 'lnurl';
const sslProtocol = 'https:';
const tag = 'channelRequest';
const typeDefault = '0';
const types = [{name: 'Public', value: '0'}, {name: 'Private', value: '1'}];
const wordsAsUtf8 = n => Buffer.from(bech32.fromWords(n)).toString('utf8');

/** Request inbound channel from lnurl

  {
    ask: <Ask Function>
    lnd: <Authenticated LND API Object>
    lnurl: <Lnurl String>
    logger: <Winston Logger Object>
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
          return cbk([400, 'ExpectedRequestFunctionToGetLnurlRequestChannel']);
        }

        return cbk();
      },

      // Get node identity public key
      getIdentity: ['validate', ({}, cbk) => {
        return getIdentity({lnd: args.lnd}, cbk);
      }],

      // Get the list of connected peers to determine if connection is needed
      getPeers: ['validate', ({}, cbk) => getPeers({lnd: args.lnd}, cbk)],

      // Get accepted terms from the encoded url
      getTerms: ['validate', ({}, cbk) => {
        const {words} = decode(asLnurl(args.lnurl), bech32CharLimit);

        const url = wordsAsUtf8(words);

        return args.request({url, json: true}, (err, r, json) => {
          if (!!err) {
            return cbk([503, 'FailureGettingLnurlDataFromUrl', {err}]);
          }

          if (!json) {
            return cbk([503, 'ExpectedJsonObjectReturnedInLnurlResponse']);
          }

          if (json.status === errorStatus) {
            return cbk([503, 'UnexpectedServiceError', {err: json.reason}]);
          }

          if (!json.callback) {
            return cbk([503, 'ExpectedCallbackInLnurlResponseJson']);
          }

          try {
            new URL(json.callback);
          } catch (err) {
            return cbk([503, 'ExpectedValidLnurlResponseCallbackUrl', {err}]);
          }

          if ((new URL(json.callback)).protocol !== sslProtocol) {
            return cbk([400, 'LnurlsThatSpecifyNonSslUrlsAreUnsupported']);
          }

          if (!json.k1) {
            return cbk([503, 'ExpectedK1InLnurlChannelResponseJson']);
          }

          if (!json.tag) {
            return cbk([503, 'ExpectedTagInLnurlChannelResponseJson']);
          }

          if (json.tag !== tag) {
            return cbk([503, 'ExpectedTagToBeChannelRequestInLnurlResponse']);
          }

          if (!json.uri) {
            return cbk([503, 'ExpectedUriInLnurlResponseJson']);
          }

          // uri: remote node address of form node_key@ip_address:port_number
          const [id, socket] = parseUri(json.uri);

          if (!isPublicKey(id)) {
            return cbk([503, 'ExpectedValidPublicKeyIdInLnurlResponseJson']);
          }

          if (!socket) {
            return cbk([503, 'ExpectedNetworkSocketAddressInLnurlResponse']);
          }

          return cbk(null, {id, socket, k1: json.k1, url: json.callback});
        });
      }],

      // Get the node alias
      getAlias: ['getTerms', ({getTerms}, cbk) => {
        return getNodeAlias({id: getTerms.id, lnd: args.lnd}, cbk);
      }],

      // Connect to the peer returned in the lnurl response
      connect: [
        'getAlias',
        'getPeers',
        'getTerms',
        ({getAlias, getPeers, getTerms}, cbk) =>
      {
        // Exit early when the node is already connected
        if (getPeers.peers.map(n => n.public_key).includes(getTerms.id)) {
          return cbk();
        }

        args.logger.info({
          connecting_to: {
            alias: getAlias.alias || undefined,
            public_key: getTerms.id,
            socket: getTerms.socket,
          },
        });

        return addPeer({
          lnd: args.lnd,
          public_key: getTerms.id,
          socket: getTerms.socket,
        },
        cbk);
      }],

      // Select private or public mode for the channel
      askPrivate: ['connect', 'getTerms', ({getTerms}, cbk) => {
        return args.ask({
          choices: types,
          default: typeDefault,
          message: 'Channel type?',
          name: 'priv',
          type: 'list',
        },
        ({priv}) => cbk(null, priv));
      }],

      // Confirm that an inbound channel should be requested
      ok: ['askPrivate', 'getAlias', ({askPrivate, getAlias}, cbk) => {
        const node = getAlias.alias || getAlias.id;
        const type = !!askPrivate ? 'a private' : 'an';

        return args.ask({
          default: true,
          message: `Request ${type} inbound channel from ${node}?`,
          name: 'ok',
          type: 'confirm',
        },
        ({ok}) => cbk(null, ok));
      }],

      // Send a signal to cancel the channel request
      sendCancelation: [
        'getIdentity',
        'getTerms',
        'ok',
        ({channel, getTerms, ok}, cbk) =>
      {
        // Exit early when user wants to proceed with the channel request
        if (!!ok) {
          return cbk();
        }

        return args.request({
          json: true,
          qs: {
            cancel: Number(!ok),
            k1: getTerms.k1,
            remoteid: getIdentity.public_key,
          },
          url: getTerms.url,
        },
        (err, r, json) => {
          if (!!err) {
            return cbk([503, 'UnexpectedErrorCancelingChannelRequest', {err}]);
          }

          if (!json) {
            return cbk([503, 'ExpectedJsonObjectInCancelChannelResponse']);
          }

          if (json.status === errorStatus) {
            return cbk([503, 'ChannelCancelReturnedErr', {err: json.reason}]);
          }

          if (json.status !== okStatus) {
            return cbk([503, 'ExpectedOkStatusInCancelChannelResponse']);
          }

          return cbk([400, 'CanceledRequestForInboundChannel']);
        });
      }],

      // Make the request to confirm a request for an inbound channel
      sendConfirmation: [
        'askPrivate',
        'getIdentity',
        'getTerms',
        'ok',
        ({askPrivate, getIdentity, getTerms, ok}, cbk) =>
      {
        // Exit early when the user decides to cancel
        if (!ok) {
          return cbk();
        }

        return args.request({
          json: true,
          qs: {
            k1: getTerms.k1,
            private: askPrivate,
            remoteid: getIdentity.public_key,
          },
          url: getTerms.url,
        },
        (err, r, json) => {
          if (!!err) {
            return cbk([503, 'UnexpectedErrorRequestingLnurlChannel', {err}]);
          }

          if (!json) {
            return cbk([503, 'ExpectedJsonObjectReturnedInChannelResponse']);
          }

          if (json.status === errorStatus) {
            return cbk([503, 'ChannelRequestReturnedErr', {err: json.reason}]);
          }

          if (json.status !== okStatus) {
            return cbk([503, 'ExpectedOkStatusInChannelRequestResponse']);
          }

          args.logger.info({requested_channel_open: true});

          return cbk();
        });
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
