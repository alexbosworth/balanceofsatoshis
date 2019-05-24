const asyncAuto = require('async/auto');
const {authenticatedLndGrpc} = require('ln-service');
const {createInvoice} = require('ln-service');
const {getChannel} = require('ln-service');
const {getChannels} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {routeFromChannels} = require('ln-service');
const {pay} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const {lndCredentials} = require('./../lnd');

const {floor} = Math;
const {isArray} = Array;
const minFeeRate = 0;
const minReceivableMtokens = 1000n;
const mtokPerTok = 1000n;
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
    credentials: cbk => lndCredentials({node}, cbk),

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
    lnd: ['credentials', 'validate', ({credentials}, cbk) => {
      const {cert, macaroon, socket} = credentials;

      return cbk(null, authenticatedLndGrpc({cert, macaroon, socket}).lnd);
    }],

    // Get channels
    getChannels: ['lnd', ({lnd}, cbk) => getChannels({lnd}, cbk)],

    // Peer channel
    peerChannel: ['getChannels', ({getChannels}, cbk) => {
      const {channels} = getChannels;

      const withPeer = channels.filter(n => n.partner_public_key === to);

      if (!withPeer.length) {
        return cbk([400, 'ExpectedDirectChannelWithPeerToGiftTo']);
      }

      const active = withPeer.filter(n => !!n.is_active);

      if (!active.length) {
        return cbk([400, 'ExpectedActiveChannelWithPeerToGiftTo']);
      }

      const hasTokens = active.filter(n => n.local_balance > tokens);

      if (!hasTokens.length) {
        return cbk([400, 'ExpectedChannelWithAvailableFundsToGift']);
      }

      const hasRemoteBalance = hasTokens
        .filter(n => n.remote_balance > floor(n.capacity * reserveRatio));

      if (!hasRemoteBalance.length) {
        return cbk([400, 'ExpectedChannelWithSufficientRemoteReserveBalance']);
      }

      hasRemoteBalance.sort((a, b) => {
        return a.local_balance > b.local_balance ? -1 : 1;
      });

      const [channel] = hasRemoteBalance;

      return cbk(null, channel.id);
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
      const channel = getChannel;
      const destination = getWallet.public_key;
      const height = getWallet.current_block_height;
      const invoice = createInvoice;
      const mtokens = minReceivableMtokens.toString();
      const mtokensToGive = BigInt(tokens) * mtokPerTok;

      const peerPolicy = channel.policies.find(n => n.public_key === to);

      peerPolicy.base_fee_mtokens = mtokensToGive.toString();
      peerPolicy.fee_rate = minFeeRate;

      const channels = [channel, channel];

      try {
        const {route} = routeFromChannels({
          channels,
          destination,
          height,
          mtokens,
        });

        return cbk(null, route);
      } catch (err) {
        return cbk([500, 'FailedToConstructGiftRoute', err]);
      }
    }],

    // Pay
    pay: [
      'createInvoice',
      'lnd',
      'route',
      ({createInvoice, lnd, route}, cbk) =>
    {
      const path = {id: createInvoice.id, routes: [route]};

      return pay({lnd, path}, (err, res) => {
        if (!err) {
          return cbk(null, {fee: res.fee});
        }

        if (!isArray(err)) {
          return cbk([503, 'UnexpectedErrorSendingTokens', err]);
        }

        const [errCode, errMessage] = err;

        switch (errMessage) {
        case 'RejectedUnacceptableFee':
          return cbk([400, 'GiftTokensAmountTooLowToSend']);

        default:
          return cbk([503, 'UnexpectedErrorSendingGiftTokens', errMessage]);
        }
      });
    }],

    // Done paying
    paid: ['pay', ({pay}, cbk) => cbk(null, {gave_tokens: pay.fee})],
  },
  returnResult({of: 'paid'}, cbk));
};
