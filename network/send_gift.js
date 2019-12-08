const asyncAuto = require('async/auto');
const {createInvoice} = require('ln-service');
const {getChannel} = require('ln-service');
const {getChannels} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {payViaRoutes} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const {channelForGift} = require('./../routing');
const giftCallbackError = require('./gift_callback_error');
const {giftRoute} = require('./../routing');

/** Send a gift of some tokens to a peer.

  {
    lnd: <Authenticated LND gRPC API Object>
    to: <To Node Public Key Hex string>
    tokens: <Tokens to Gift Number>
  }

  @returns via cbk or Promise
  {
    gave_tokens: <Gave Tokens Number>
  }
*/
module.exports = ({lnd, to, tokens}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedLndToSendGiftWith']);
        }

        if (!to) {
          return cbk([400, 'ExpectedPeerToSendGiftTo']);
        }

        if (!tokens) {
          return cbk([400, 'ExpectedTokensToGiftToPeer']);
        }

        return cbk();
      },

      // Get channels
      getChannels: ['validate', ({}, cbk) => getChannels({lnd}, cbk)],

      // Peer channel
      peerChannel: ['getChannels', ({getChannels}, cbk) => {
        try {
          const {channels} = getChannels;

          const {id} = channelForGift({channels, to, tokens});

          return cbk(null, id);
        } catch (err) {
          return cbk(giftCallbackError({err}));
        }
      }],

      // Get channel policy info
      getChannel: ['peerChannel', ({peerChannel}, cbk) => {
        return getChannel({lnd, id: peerChannel}, cbk);
      }],

      // Create invoice
      createInvoice: ['getChannel', ({l}, cbk) => createInvoice({lnd}, cbk)],

      // Get wallet
      getWallet: ['getChannel', ({}, cbk) => getWalletInfo({lnd}, cbk)],

      // Route
      route: [
        'createInvoice',
        'getChannel',
        'getWallet',
        ({createInvoice, getChannel, getWallet}, cbk) =>
      {
        try {
          const {route} = giftRoute({
            tokens,
            channel: getChannel,
            destination: getWallet.public_key,
            height: getWallet.current_block_height,
          });

          return cbk(null, route);
        } catch (err) {
          const {message} = err;

          switch (message) {
          case 'GiftAmountTooLowToSend':
          case 'OwnPolicyTooLowToCompleteForward':
          case 'PeerPolicyTooLowToCompleteForward':
            return cbk([400, 'AmountTooLowToCompleteGiftSend']);

          default:
            return cbk([500, 'FailedToConstructGiftRoute', {err}]);
          }
        }
      }],

      // Send the gift
      pay: ['createInvoice', 'route', ({createInvoice, route}, cbk) => {
        const {id} = createInvoice;

        return payViaRoutes({id, lnd, routes: [route]}, (err, res) => {
          if (!!err) {
            const [errCode, errMessage] = err;

            switch (errMessage) {
            case 'RejectedUnacceptableFee':
              return cbk([400, 'GiftTokensAmountTooLowToSend']);

            default:
              return cbk([503, 'UnexpectedErrorSendingGiftTokens', {err}]);
            }
          }

          return cbk(null, {gave_tokens: res.fee});
        });
      }],

      // Done paying
      paid: ['pay', ({pay}, cbk) => cbk(null, {gave_tokens: pay.gave_tokens})],
    },
    returnResult({reject, resolve, of: 'paid'}, cbk));
  });
};
