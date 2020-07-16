const {test} = require('@alexbosworth/tap');

const peerLiquidity = require('./../../balances/peer_liquidity');

const tests = [
  {
    args: {
      channels: [{
        local_balance: 1,
        pending_payments: [
          {
            id: 'id',
            is_outgoing: true,
            tokens: 1,
          },
          {
            id: 'id',
            is_outgoing: false,
            tokens: 1,
          },
          {
            id: 'id3',
            is_outgoing: true,
            tokens: 1,
          },
          {
            id: 'id2',
            is_outgoing: false,
            tokens: 2,
          },
        ],
        remote_balance: 1,
      }],
      opening: [{
        local_balance: 1,
        remote_balance: 1,
      }],
      settled: 'id',
    },
    description: 'Channels are mapped to liquidity balances',
    expected: {
      liquidity: {
        inbound: 2,
        inbound_opening: 1,
        inbound_pending: 1,
        outbound: 2,
        outbound_opening: 1,
        outbound_pending: 2,
      },
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, ({deepIs, end, equal, throws}) => {
    if (!!error) {
      throws(() => peerLiquidity(args), new Error(error));
    } else {
      const liquidity = peerLiquidity(args);

      deepIs(liquidity, expected.liquidity, 'Got expected liquidity');
    }

    return end();
  });
});
