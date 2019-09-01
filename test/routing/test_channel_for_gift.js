const {test} = require('tap');

const {channelForGift} = require('./../../routing');

const tests = [
  {
    args: {},
    description: 'An array of channels is required',
    error: 'ExpectedArrayOfChannelsToFindChannelWithBalance',
  },
  {
    args: {channels: [null]},
    description: 'An array of channels objects is required',
    error: 'ExpectedChannelsInArrayOfChannels',
  },
  {
    args: {channels: []},
    description: 'A to public key is required',
    error: 'ExpectedToPublicKeyToFindChannelWithBalance',
  },
  {
    args: {channels: [], to: 'bob'},
    description: 'Tokens are required',
    error: 'ExpectedTokensToFindChannelWithSufficientBalance',
  },
  {
    args: {channels: [], to: 'bob', tokens: 1},
    description: 'A direct channel is required',
    error: 'NoDirectChannelWithSpecifiedPeer',
  },
  {
    args: {channels: [{partner_public_key: 'bob'}], to: 'bob', tokens: 1},
    description: 'An active channel is required',
    error: 'NoActiveChannelWithSpecifiedPeer',
  },
  {
    args: {
      channels: [{is_active: true, partner_public_key: 'bob'}],
      to: 'bob',
      tokens: 1,
    },
    description: 'A channel with enough balance is required',
    error: 'NoActiveChannelWithSufficientLocalBalance',
  },
  {
    args: {
      channels: [{
        capacity: 20000,
        is_active: true,
        local_balance: 10000,
        partner_public_key: 'bob',
      }],
      to: 'bob',
      tokens: 500,
    },
    description: 'A channel with enough remote balance is required',
    error: 'NoActiveChannelWithSufficientRemoteBalance',
  },
  {
    args: {
      channels: [{
        capacity: 20000,
        id: 'id',
        is_active: true,
        local_balance: 10000,
        partner_public_key: 'bob',
        remote_balance: 10000,
      }],
      to: 'bob',
      tokens: 500,
    },
    description: 'A balanced channel is returned',
    expected: {id: 'id'},
  },
  {
    args: {
      channels: [
        {
          capacity: 20000,
          id: 'id1',
          is_active: true,
          local_balance: 200,
          local_reserve: 100,
          partner_public_key: 'bob',
          remote_balance: 19800,
        },
        {
          capacity: 20000,
          id: 'id2',
          is_active: true,
          local_balance: 10000,
          local_reserve: 100,
          partner_public_key: 'bob',
          remote_balance: 10000,
        },
      ],
      to: 'bob',
      tokens: 500,
    },
    description: 'A channel with enough remote balance is required',
    expected: {id: 'id2'},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, ({end, equal, throws}) => {
    if (!!error) {
      throws(() => channelForGift(args), new Error(error), 'Got error');
    } else {
      const {id} = channelForGift(args);

      equal(id, expected.id, 'Channel id is returned as expected');
    }

    return end();
  });
});
