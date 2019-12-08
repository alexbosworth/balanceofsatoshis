const {test} = require('tap');

const {getLiquidity} = require('./../../balances');

const makeChannels = () => {
  return [
    {
      active: true,
      capacity: '1',
      chan_id: '1',
      channel_point: '00:1',
      commit_fee: 1,
      commit_weight: 1,
      fee_per_kw: 1,
      local_balance: 1,
      local_chan_reserve_sat: 1,
      num_updates: 1,
      pending_htlcs: [],
      private: false,
      remote_balance: 1,
      remote_chan_reserve_sat: 1,
      remote_pubkey: 'b',
      total_satoshis_received: 1,
      total_satoshis_sent: 1,
      unsettled_balance: 1,
    },
    {
      active: true,
      capacity: '1',
      chan_id: '1',
      channel_point: '00:1',
      commit_fee: 1,
      commit_weight: 1,
      fee_per_kw: 1,
      local_balance: 1,
      local_chan_reserve_sat: 1,
      num_updates: 1,
      pending_htlcs: [],
      private: false,
      remote_balance: 1,
      remote_chan_reserve_sat: 1,
      remote_pubkey: 'b',
      total_satoshis_received: 1,
      total_satoshis_sent: 1,
      unsettled_balance: 1,
    },
    {
      active: true,
      capacity: '1',
      chan_id: '1',
      channel_point: '00:1',
      commit_fee: 1,
      commit_weight: 1,
      fee_per_kw: 1,
      local_balance: 1,
      local_chan_reserve_sat: 1,
      num_updates: 1,
      pending_htlcs: [],
      private: false,
      remote_balance: 1,
      remote_chan_reserve_sat: 1,
      remote_pubkey: 'b',
      total_satoshis_received: 1,
      total_satoshis_sent: 1,
      unsettled_balance: 1,
    },
  ];
};

const tests = [
  {
    args: {},
    description: 'LND is required',
    error: [400, 'ExpectedLndToGetLiquidity'],
  },
  {
    args: {
      is_top: true,
      lnd: {
        default: {
          listChannels: ({}, cbk) => cbk(null, {channels: makeChannels()}),
        },
      },
    },
    description: 'Liquidity is returned',
    expected: {balance: 1},
  },
  {
    args: {
      is_outbound: true,
      lnd: {
        default: {
          listChannels: ({}, cbk) => cbk(null, {channels: makeChannels()}),
        },
      },
      with: 'b',
    },
    description: 'Liquidity is returned',
    expected: {balance: 3},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects}) => {
    if (!!error) {
      rejects(getLiquidity(args), error, 'Got expected error');
    } else {
      const {balance} = await getLiquidity(args);

      equal(balance, expected.balance, 'Balance is calculated');
    }

    return end();
  });
});
