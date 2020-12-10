const {test} = require('tap');

const peersWithActivity = require('./../../network/peers_with_activity');

const tests = [
  {
    args: {
      additions: [Buffer.alloc(33, 3).toString('hex')],
      channels: [{
        id: '1x1x1',
        local_balance: 1,
        partner_public_key: Buffer.alloc(33, 2).toString('hex'),
        remote_balance: 2,
      }],
      forwards: [
        {
          outgoing_channel: '2x2x2',
          tokens: 3,
        },
        {
          outgoing_channel: '1x1x1',
          tokens: 3,
        },
        {
          outgoing_channel: '3x3x3',
          tokens: 4,
        },
      ],
      terminated: [{
        id: '3x3x3',
        partner_public_key: Buffer.alloc(33, 3).toString('hex'),
      }],
    },
    description: 'A set of peers with activity is expected',
    expected: {
      peers: [
        {
          forwarded: 4,
          inbound: 0,
          outbound: 0,
          public_key: Buffer.alloc(33, 3).toString('hex'),
        },
        {
          forwarded: 3,
          inbound: 2,
          outbound: 1,
          public_key: Buffer.alloc(33, 2).toString('hex'),
        },
      ],
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({deepIs, end, throws}) => {
    if (!!error) {
      throws(() => peersWithActivity(args), new Error(error), 'Got error');
    } else {
      const res = peersWithActivity(args);

      deepIs(res, expected, 'Got expected result');
    }

    return end();
  });
});
