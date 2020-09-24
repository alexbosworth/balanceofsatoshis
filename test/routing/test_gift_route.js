const {test} = require('tap');

const {giftRoute} = require('./../../routing');

const tests = [
  {
    args: {},
    description: 'A channel is required',
    error: 'ExpectedChannelToCalculateGiftRoute',
  },
  {
    args: {channel: {}},
    description: 'A destination is required',
    error: 'ExpectedDestinationToCalculateGiftRoute',
  },
  {
    args: {channel: {}, destination: 'b'},
    description: 'The current chain tip height is required',
    error: 'ExpectedHeightToCalculateGiftRoute',
  },
  {
    args: {channel: {}, destination: 'b', height: 1},
    description: 'Tokens to gift are required',
    error: 'ExpectedTokensToCalculateGiftRoute',
  },
  {
    args: {channel: {}, destination: 'b', height: 1, tokens: 1},
    description: 'Channel policies array is required',
    error: 'ExpectedChannelPoliciesToCalculateGiftRoute',
  },
  {
    args: {channel: {policies: [{}]}, destination: 'b', height: 1, tokens: 1},
    description: 'Channel policies need public keys',
    error: 'ExpectedChannelPoliciesToCalculateGiftRoute',
  },
  {
    args: {
      channel: {policies: [{public_key: 'c'}]},
      destination: 'b',
      height: 1,
      tokens: 1,
    },
    description: 'Channel policies require a destination policy',
    error: 'ExpectedDestinationPolicyToCalculateGiftRoute',
  },
  {
    args: {
      channel: {policies: [{public_key: 'b'}]},
      destination: 'b',
      height: 1,
      tokens: 1,
    },
    description: 'Channel policies require the peer policy',
    error: 'ExpectedPeerPolicyToCalculateGiftRoute',
  },
  {
    args: {
      channel: {
        id: '1x1x1',
        policies: [
          {cltv_delta: 1, public_key: 'b'},
          {cltv_delta: 1, min_htlc_mtokens: '100000', public_key: 'c'},
        ],
      },
      destination: 'b',
      height: 1,
      tokens: 1,
    },
    description: 'The peer min htlc policy has to be high enough to forward',
    error: 'PeerPolicyTooLowToCompleteForward',
  },
  {
    args: {
      channel: {
        id: '1x1x1',
        policies: [
          {cltv_delta: 1, public_key: 'b'},
          {base_fee_mtokens: '1001', cltv_delta: 1, public_key: 'c'},
        ],
      },
      destination: 'b',
      height: 1,
      tokens: 1,
    },
    description: 'The real fee must be lower than the gift fee',
    error: 'GiftAmountTooLowToSend',
  },
  {
    args: {
      channel: {
        id: '1x1x1',
        policies: [
          {cltv_delta: 1, public_key: 'b'},
          {cltv_delta: 1, public_key: 'c'},
        ],
      },
      destination: 'b',
      height: 1,
      tokens: 1,
    },
    description: 'Route is created',
    expected: {
      route: {
      fee: 1,
        fee_mtokens: '1000',
        hops: [
          {
            channel: '1x1x1',
            channel_capacity: undefined,
            fee: 1,
            fee_mtokens: '1000',
            forward: 1,
            forward_mtokens: '1000',
            public_key: 'c',
            timeout: 41,
          },
          {
            channel: '1x1x1',
            channel_capacity: undefined,
            fee: 0,
            fee_mtokens: '0',
            forward: 1,
            forward_mtokens: '1000',
            public_key: 'b',
            timeout: 41,
          },
        ],
        messages: undefined,
        mtokens: '2000',
        payment: undefined,
        timeout: 42,
        tokens: 2,
        total_mtokens: undefined,
      },
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({deepIs, end, throws}) => {
    if (!!error) {
      throws(() => giftRoute(args), new Error(error), 'Got expected error');
    } else {
      deepIs(giftRoute(args).route, expected.route, 'Got expected route');
    }

    return end();
  });
});
