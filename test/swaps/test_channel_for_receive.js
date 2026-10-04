const {deepEqual} = require('node:assert').strict;
const test = require('node:test');

const channelForReceive = require('./../../swaps/channel_for_receive');

const peer = Buffer.alloc(33, 3).toString('hex');
const self = Buffer.alloc(33, 2).toString('hex');

const makeChannel = overrides => {
  const channel = {
    commit_transaction_fee: 1000,
    commit_transaction_weight: 1000,
    id: '1x1x1',
    is_active: true,
    is_partner_initiated: false,
    partner_public_key: peer,
    policies: [{public_key: peer}, {public_key: self}],
    remote_balance: 1000000,
    remote_reserve: 10000,
  };

  Object.keys(overrides).forEach(k => channel[k] = overrides[k]);

  return channel;
};

const tests = [
  {
    args: {
      channels: [
        makeChannel({}),
        makeChannel({id: '2x2x2', remote_balance: 5000000}),
      ],
      id: '1x1x1',
      peer,
      tokens: 500000,
    },
    description: 'The preferred channel is kept when it can receive the amount',
    expected: {id: '1x1x1', receivable: 990000},
  },
  {
    args: {
      channels: [
        makeChannel({}),
        makeChannel({id: '2x2x2', remote_balance: 5000000}),
        makeChannel({id: '3x3x3', remote_balance: 3000000}),
      ],
      id: '1x1x1',
      peer,
      tokens: 2000000,
    },
    description: 'The channel that can receive the most is chosen',
    expected: {id: '2x2x2', receivable: 4990000},
  },
  {
    args: {
      channels: [
        makeChannel({}),
        makeChannel({id: '2x2x2', remote_balance: 5000000}),
      ],
      peer,
      tokens: 500000,
    },
    description: 'Without a preferred channel the largest is chosen',
    expected: {id: '2x2x2', receivable: 4990000},
  },
  {
    args: {
      channels: [
        makeChannel({}),
        makeChannel({
          id: '2x2x2',
          policies: [{is_disabled: true, public_key: peer}, {public_key: self}],
          remote_balance: 5000000,
        }),
      ],
      id: '1x1x1',
      peer,
      tokens: 2000000,
    },
    description: 'A channel the peer disabled towards us is not chosen',
    expected: {id: '1x1x1', receivable: 990000},
  },
  {
    args: {
      channels: [
        makeChannel({}),
        makeChannel({
          id: '2x2x2',
          policies: [
            {max_htlc_mtokens: '1500000000', public_key: peer},
            {public_key: self},
          ],
          remote_balance: 5000000,
        }),
      ],
      id: '1x1x1',
      peer,
      tokens: 2000000,
    },
    description: 'The peer max HTLC limits what a channel can receive',
    expected: {id: '2x2x2', receivable: 1500000},
  },
  {
    args: {
      channels: [
        makeChannel({}),
        makeChannel({id: '2x2x2', is_active: false, remote_balance: 5000000}),
        makeChannel({
          id: '3x3x3',
          partner_public_key: self,
          remote_balance: 5000000,
        }),
      ],
      id: '1x1x1',
      peer,
      tokens: 2000000,
    },
    description: 'Inactive channels and other peer channels are not chosen',
    expected: {id: '1x1x1', receivable: 990000},
  },
  {
    args: {
      channels: [
        makeChannel({is_partner_initiated: true}),
        makeChannel({id: '2x2x2', remote_balance: 1000000}),
      ],
      id: '1x1x1',
      peer,
      tokens: 2000000,
    },
    description: 'A partner that pays for commitment fees keeps a fee buffer',
    expected: {id: '2x2x2', receivable: 990000},
  },
  {
    args: {
      channels: [makeChannel({remote_balance: 10000})],
      id: '1x1x1',
      peer,
      tokens: 500000,
    },
    description: 'No channel is chosen when none can receive anything',
    expected: {},
  },
];

tests.forEach(({args, description, expected}) => {
  return test(description, (t, end) => {
    const res = channelForReceive(args);

    deepEqual(res, expected, 'Got expected result');

    return end();
  });
});
