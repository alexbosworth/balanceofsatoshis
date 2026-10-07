const {deepEqual} = require('node:assert').strict;
const test = require('node:test');

const method = require('./../../network/pending_summary');

const peerA = Buffer.alloc(33).toString('hex');
const peerB = Buffer.alloc(33, 1).toString('hex');
const peerC = Buffer.alloc(33, 2).toString('hex');
const peerD = Buffer.alloc(33, 3).toString('hex');
const peerE = Buffer.alloc(33, 4).toString('hex');
const peerF = Buffer.alloc(33, 5).toString('hex');

const makeNode = overrides => {
  const node = {
    closing: [],
    forwarding: [],
    opening: [],
    sending: [],
    alias: 'node',
    public_key: peerF,
  };

  Object.keys(overrides).forEach(k => node[k] = overrides[k]);

  return node;
};

const opening = {
  capacity: 1000000,
  is_partner_initiated: true,
  peer_alias: '🧙 Peer 🐸',
  peer_public_key: peerA,
  transaction_id: 'ab',
};

const probing = {
  fee: 1,
  hops: [
    {alias: 'Out', public_key: peerB},
    {alias: 'Next', public_key: peerC},
    {public_key: peerD},
  ],
  is_rebalance: false,
  tokens: 100,
};

const rebalancing = {
  fee: 2,
  hops: [
    {alias: 'Out', public_key: peerB},
    {alias: 'Next', public_key: peerC},
    {alias: 'In', public_key: peerD},
    {alias: 'node', public_key: peerF},
  ],
  is_rebalance: true,
  tokens: 500000,
};

const tests = [
  {
    args: {is_monochrome: true, nodes: [makeNode({})]},
    description: 'Nothing pending is summarized',
    expected: {summary: 'No pending payments or channels'},
  },
  {
    args: {
      is_monochrome: true,
      nodes: [
        makeNode({
          closing: [
            {
              blocks_until_recovery: 144,
              close_transaction_id: 'cd',
              peer_alias: 'Closing',
              peer_public_key: peerC,
              pending_balance: 500000,
            },
            {
              close_transaction_id: 'ef',
              peer_alias: 'Waiting',
              peer_public_key: peerD,
              pending_balance: 1,
            },
            {
              peer_alias: 'Empty',
              peer_public_key: peerE,
            },
          ],
          forwarding: [
            {
              fee: 1,
              in_peer_alias: 'In',
              in_peer_public_key: peerA,
              out_peer_alias: 'Out',
              out_peer_public_key: peerB,
              tokens: 100,
            },
            {
              fee: 0,
              in_peer_alias: 'In',
              in_peer_public_key: peerA,
              out_peer_alias: 'Out',
              out_peer_public_key: peerB,
              tokens: 100,
            },
          ],
          opening: [opening],
          sending: [
            probing,
            rebalancing,
            {hops: [{public_key: peerE}], is_rebalance: false, tokens: 50},
          ],
        }),
      ],
      tagged: [
        {icons: ['🚀'], public_key: peerA},
        {icons: ['🎯', '🧊'], public_key: peerE},
      ],
    },
    description: 'Pending items for a single node are summarized',
    expected: {
      summary: [
        'Waiting to recover 0.00500000 in 1 day from closing channel with Closing 02020202',
        'Waiting to recover 0.00000001 from closing channel with Waiting 03030303: ef',
        'Waiting to close channel with 🎯 🧊 Empty 04040404',
        'Waiting for inbound 0.01000000 channel with 🚀 Peer 00000000 to confirm: ab',
        'Forwarding 0.00000100 for 0.00000001 fee from 🚀 In 00000000 to Out 01010101',
        'Forwarding 0.00000100 from 🚀 In 00000000 to Out 01010101',
        'Probing 0.00000100 for 0.00000001 fee out Out 01010101 → Next 02020202 → 03030303',
        'Rebalancing 0.00500000 for 0.00000002 fee out Out 01010101 → Next 02020202 → In 03030303',
        'Probing 0.00000050 out 🎯 🧊 04040404',
      ].join('\n'),
    },
  },
  {
    args: {
      is_monochrome: true,
      nodes: [
        makeNode({alias: '🤖 first', opening: [opening], public_key: peerA}),
        makeNode({alias: 'second', public_key: peerB}),
        makeNode({alias: undefined, public_key: peerC, sending: [probing]}),
      ],
      tagged: [{icons: ['🚀'], public_key: peerA}],
    },
    description: 'Pending items for multiple nodes are grouped by node',
    expected: {
      summary: [
        '🤖 first 00000000',
        'Waiting for inbound 0.01000000 channel with 🚀 Peer 00000000 to confirm: ab',
        '',
        '02020202',
        'Probing 0.00000100 for 0.00000001 fee out Out 01010101 → Next 02020202 → 03030303',
      ].join('\n'),
    },
  },
  {
    args: {
      is_monochrome: true,
      max_relays: 1,
      nodes: [
        makeNode({
          sending: [
            probing,
            rebalancing,
            {
              hops: [
                {alias: 'Out', public_key: peerB},
                {alias: 'Next', public_key: peerC},
                {alias: 'Far', public_key: peerD},
                {alias: 'In', public_key: peerE},
                {alias: 'node', public_key: peerF},
              ],
              is_rebalance: true,
              tokens: 500000,
            },
          ],
        }),
      ],
    },
    description: 'Relaying peers of paths are collapsed to a maximum count',
    expected: {
      summary: [
        'Probing 0.00000100 for 0.00000001 fee out Out 01010101 → Next 02020202 → 03030303',
        'Rebalancing 0.00500000 for 0.00000002 fee out Out 01010101 → Next 02020202 → In 03030303',
        'Rebalancing 0.00500000 out Out 01010101 → Next 02020202 → ...1 more... → In 04040404',
      ].join('\n'),
    },
  },
  {
    args: {
      is_monochrome: true,
      max_relays: 0,
      nodes: [makeNode({sending: [probing, rebalancing]})],
    },
    description: 'All relaying peers of paths are collapsed',
    expected: {
      summary: [
        'Probing 0.00000100 for 0.00000001 fee out Out 01010101 → ...1 more... → 03030303',
        'Rebalancing 0.00500000 for 0.00000002 fee out Out 01010101 → ...1 more... → In 03030303',
      ].join('\n'),
    },
  },
];

tests.forEach(({args, description, expected}) => {
  return test(description, () => {
    deepEqual(method(args), expected, 'Got expected pending summary');

    return;
  });
});
