const {test} = require('tap');

const channelForSend = require('./../../swaps/channel_for_send');

const tests = [
  {
    args: {
      channels: [{
        id: '1x1x1',
        local_balance: 3,
        local_reserve: 1,
        partner_public_key: Buffer.alloc(33, 3).toString('hex'),
      }],
      peer: Buffer.alloc(33, 3).toString('hex'),
      tokens: 1,
    },
    description: 'A channel is selected for a send',
    expected: {id: '1x1x1'},
  },
  {
    args: {
      channels: [{
        id: '1x1x1',
        local_balance: 2,
        local_reserve: 1,
        partner_public_key: Buffer.alloc(33, 3).toString('hex'),
      }],
      peer: Buffer.alloc(33, 3).toString('hex'),
      tokens: 1,
    },
    description: 'No channel is selected for a send',
    expected: {},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, ({end, equal, strictSame, throws}) => {
    if (!!error) {
      throws(() => channelForSend(args), new Error(error), 'Got error');
    } else {
      const res = channelForSend(args);

      strictSame(res, expected, 'Got expected result');
    }

    return end();
  });
});
