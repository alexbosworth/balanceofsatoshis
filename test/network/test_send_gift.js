const {test} = require('tap');

const {chanInfoResponse} = require('./../fixtures');
const {getInfoResponse} = require('./../fixtures');
const {listChannelsResponse} = require('./../fixtures');
const {sendGift} = require('./../../network');

const pubKey = '000000000000000000000000000000000000000000000000000000000000000000';

const tests = [
  {
    args: {},
    description: 'LND is required to send a gift',
    error: [400, 'ExpectedLndToSendGiftWith'],
  },
  {
    args: {lnd: {}},
    description: 'Peer public key is required to send a gift',
    error: [400, 'ExpectedPeerToSendGiftTo'],
  },
  {
    args: {lnd: {}, to: pubKey},
    description: 'Tokens are required to send a gift',
    error: [400, 'ExpectedTokensToGiftToPeer'],
  },
  {
    args: {
      lnd: {
        default: {
          listChannels: ({}, cbk) => cbk(null, {channels: []})
        },
      },
      to: pubKey,
      tokens: 1,
    },
    description: 'A channel is required to send a gift',
    error: [400, 'SendingGiftRequiresDirectChannelWithPeer'],
  },
  {
    args: {
      lnd: {
        default: {
          addInvoice: ({}, cbk) => cbk(null, {
            payment_request: 'payment_request',
            r_hash: Buffer.alloc(32),
          }),
          getChanInfo: (args, cbk) => cbk(null, chanInfoResponse),
          getInfo: ({}, cbk) => cbk(null, getInfoResponse),
          listChannels: ({}, cbk) => cbk(null, listChannelsResponse),
        },
      },
      to: pubKey,
      tokens: 1,
    },
    description: 'A channel with balance is required to send a gift',
    error: [400, 'SendingGiftRequiresChanWithSufficientBalance'],
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects, strictSame}) => {
    if (!!error) {
      rejects(sendGift(args), error, 'Got expected error');
    } else {
      const sent = await sendGift(args);

      equal(sent.gave_tokens, expected.gave_tokens, 'Sent expected tokens');
    }

    return end();
  });
});
