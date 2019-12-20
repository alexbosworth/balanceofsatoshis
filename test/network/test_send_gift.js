const {test} = require('tap');

const {chanInfoResponse} = require('./../fixtures');
const {getInfoResponse} = require('./../fixtures');
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
          listChannels: ({}, cbk) => cbk(null, {
            channels: [{
              active: true,
              capacity: 1,
              chan_id: 1,
              channel_point: '1:0',
              commit_fee: 1,
              commit_weight: 1,
              fee_per_kw: 1,
              local_balance: 1,
              local_chan_reserve_sat: '1',
              num_updates: 1,
              pending_htlcs: [],
              private: true,
              remote_balance: 1,
              remote_chan_reserve_sat: '1',
              remote_pubkey: pubKey,
              total_satoshis_received: 1,
              total_satoshis_sent: 1,
              unsettled_balance: 1,
            }],
          }),
        },
      },
      to: pubKey,
      tokens: 1,
    },
    description: 'A channel with balance is required to send a gift',
    error: [400, 'SendingGiftRequiresChanWithSufficientBalance'],
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
          listChannels: ({}, cbk) => cbk(null, {
            channels: [{
              active: true,
              capacity: 1,
              chan_id: 1,
              channel_point: '1:0',
              commit_fee: 1,
              commit_weight: 1,
              fee_per_kw: 1,
              local_balance: 100,
              local_chan_reserve_sat: '1',
              num_updates: 1,
              pending_htlcs: [],
              private: true,
              remote_balance: 1,
              remote_chan_reserve_sat: '1',
              remote_pubkey: pubKey,
              total_satoshis_received: 1,
              total_satoshis_sent: 1,
              unsettled_balance: 1,
            }],
          }),
          lookupInvoice: ({}, cbk) => cbk(null, {
            creation_date: 1,
            description_hash: '',
            expiry: 1,
            features: {},
            htlcs: [],
            memo: '',
            payment_request: 'payment_request',
            r_preimage: Buffer.alloc(32),
            settled: false,
            value: '1',
          }),
        },
      },
      to: pubKey,
      tokens: 1,
    },
    description: 'A channel with balance is required to send a gift',
    error: [
      500,
      'FailedToConstructGiftRoute',
      {err: new Error('ExpectedDestinationPolicyToCalculateGiftRoute')},
    ],
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({deepIs, end, equal, rejects}) => {
    if (!!error) {
      rejects(sendGift(args), error, 'Got expected error');
    } else {
      const sent = await sendGift(args);

      equal(sent.gave_tokens, expected.gave_tokens, 'Sent expected tokens');
    }

    return end();
  });
});
