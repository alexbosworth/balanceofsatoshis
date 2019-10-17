const asyncAuto = require('async/auto');
const {createInvoice} = require('ln-service');
const {getChannel} = require('ln-service');
const {getChannels} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {payViaRoutes} = require('ln-service');
const {routeFromChannels} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const {authenticatedLnd} = require('./../lnd');
const {channelForGift} = require('./../routing');
const {giftRoute} = require('./../routing');
const {sortBy} = require('./../arrays');

const {floor} = Math;
const minFeeRate = 0;
const minReceivableMtokens = BigInt(1000);
const mtokPerTok = BigInt(1000);
const reserveRatio = 0.01;

/** Send a gift of some tokens to a peer.

  {
    [node]: <From Node Name String>
    to: <To Node Public Key hex string>
    tokens: <Tokens to Gift Number>
  }

  @returns via cbk
  {
    gave_tokens: <Gave Tokens Number>
  }
*/
module.exports = ({node, to, tokens}, cbk) => {
  return asyncAuto({
    // Credentials
    getLnd: cbk => authenticatedLnd({node}, cbk),

    // Check arguments
    validate: cbk => {
      if (!to) {
        return cbk([400, 'ExpectedPeerToSendGiftTo']);
      }

      if (!tokens) {
        return cbk([400, 'ExpectedTokensToGiftToPeer']);
      }

      return cbk();
    },

    // Lnd
    lnd: ['getLnd', ({getLnd}, cbk) => cbk(null, getLnd.lnd)],

    // Get channels
    getChannels: ['lnd', ({lnd}, cbk) => getChannels({lnd}, cbk)],

    // Peer channel
    peerChannel: ['getChannels', ({getChannels}, cbk) => {
      try {
        const {channels} = getChannels;

        return cbk(null, channelForGift({channels, to, tokens}).id);
      } catch (err) {
        const {message} = err;

        switch (message) {
        case 'NoActiveChannelWithSpecifiedPeer':
          return cbk([400, 'SendingGiftRequiresActiveChannelWithPeer']);

        case 'NoActiveChannelWithSufficientLocalBalance':
          return cbk([400, 'SendingGiftRequiresChannelWithSufficientBalance']);

        case 'NoActiveChannelWithSufficientRemoteBalance':
          return cbk([400, 'SendingGiftRequiresChannelWithSomeRemoteBalance']);

        case 'NoDirectChannelWithSpecifiedPeer':
          return cbk([400, 'SendingGiftRequiresDirectChannelWithPeer']);

        default:
          return cbk([500, 'UnexpectedErrorDeterminingChannelForGift', {err}]);
        }
      }
    }],

    // Get channel policy info
    getChannel: ['lnd', 'peerChannel', ({lnd, peerChannel}, cbk) => {
      return getChannel({lnd, id: peerChannel}, cbk);
    }],

    // Create invoice
    createInvoice: ['getChannel', 'lnd', ({lnd}, cbk) => {
      return createInvoice({lnd}, cbk);
    }],

    // Get wallet
    getWallet: ['getChannel', 'lnd', ({lnd}, cbk) => {
      return getWalletInfo({lnd}, cbk);
    }],

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
    pay: [
      'createInvoice',
      'lnd',
      'route',
      ({createInvoice, lnd, route}, cbk) =>
    {
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
  returnResult({of: 'paid'}, cbk));
};
