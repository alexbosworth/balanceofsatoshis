const {test} = require('tap');

const giftCallbackError = require('./../../network/gift_callback_error');

const tests = [
  {
    args: {err: {message: 'NoActiveChannelWithSpecifiedPeer'}},
    description: 'No active channel returns a user error',
    expected: {err: [400, 'SendingGiftRequiresActiveChannelWithPeer']},
  },
  {
    args: {err: {message: 'NoActiveChannelWithSufficientLocalBalance'}},
    description: 'No active channel with balance returns a user error',
    expected: {err: [400, 'SendingGiftRequiresChanWithSufficientBalance']},
  },
  {
    args: {err: {message: 'NoActiveChannelWithSufficientRemoteBalance'}},
    description: 'No channel with remote balance returns a user error',
    expected: {err: [400, 'SendingGiftRequiresChanWithSomeRemoteBalance']},
  },
  {
    args: {err: {message: 'NoDirectChannelWithSpecifiedPeer'}},
    description: 'No direct channel with peer returns a user error',
    expected: {err: [400, 'SendingGiftRequiresDirectChannelWithPeer']},
  },
  {
    args: {err: {message: 'message'}},
    description: 'An unanticipated error returns a non-user error',
    expected: {
      err: [
        500,
        'UnexpectedErrorDeterminingChanForGift',
        {err: {message: 'message'}},
      ],
    },
  },
];

tests.forEach(({args, description, expected}) => {
  return test(description, ({end, strictSame}) => {
    const err = giftCallbackError(args);

    strictSame(err, expected.err, 'Got expected error');

    return end();
  });
});
