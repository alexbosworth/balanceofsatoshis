const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const selectBlindedPath = require('./../../offchain/select_blinded_path');
const {chanInfoResponse} = require('./../fixtures');
const {getNodeInfoResponse} = require('./../fixtures');
const {versionInfoResponse} = require('./../fixtures');

const bob = '0324653eac434488002cc06bbfb7f10fe18991e35f9fe4302dbea6d23' +
  '53dc0ab1c';
const carol = '027f31ebc5462c1fdce1b737ecff52d37d75dea43ce11c74d25aa2971' +
  '65faa2007';
const dave = '032c0b7cf95324a07d05398b240174dc0c2be444d96b159aa6c7f7b1e6' +
  '68680991';
const eve = '02edabbd16b41c8371b92ef2f04c1185b4f03b6dcd52ba9b78d9d7c89c8' +
  'f221145';

const blinding = {'25': {is_known: true, is_required: false, name: 'blind'}};
const ownBobChannel = '770000000000000001';
const bobCarolChannel = '770000000000000002';
const ownDaveChannel = '770000000000000003';

const policy = {
  disabled: false,
  fee_base_msat: '1000',
  fee_rate_milli_msat: '100',
  last_update: 1700000000,
  max_htlc_msat: '990000000',
  min_htlc: '1',
  time_lock_delta: 40,
};

const channel = (id, capacity, node1, node2, policies) => ({
  ...chanInfoResponse,
  capacity,
  channel_id: id,
  node1_pub: node1,
  node1_policy: policies[0],
  node2_pub: node2,
  node2_policy: policies[1],
});

// The own node is Eve, with peers Bob and Dave. Dave has no route blinding
// feature. Bob has a channel with Carol who also supports route blinding.
const graph = {
  [bobCarolChannel]: channel(bobCarolChannel, '9000000', bob, carol, [
    policy,
    policy,
  ]),
  [ownBobChannel]: channel(ownBobChannel, '5000000', bob, eve, [
    policy,
    policy,
  ]),
  [ownDaveChannel]: channel(ownDaveChannel, '4000000', dave, eve, [
    policy,
    policy,
  ]),
};

const aliases = {[bob]: 'bob', [carol]: 'carol', [dave]: 'dave'};

const makeLnd = ({}) => {
  return {
    default: {
      getChanInfo: ({chan_id}, cbk) => cbk(null, graph[chan_id]),
      getNodeInfo: ({include_channels, pub_key}, cbk) => {
        const channels = pub_key !== bob ? [] : [
          graph[bobCarolChannel],
          graph[ownBobChannel],
        ];

        return cbk(null, {
          ...getNodeInfoResponse,
          channels: !!include_channels ? channels : [],
          node: {
            ...getNodeInfoResponse.node,
            alias: aliases[pub_key] || 'eve',
            features: pub_key === dave ? {} : blinding,
            pub_key,
          },
          num_channels: String(channels.length),
        });
      },
    },
    version: {getVersion: ({}, cbk) => cbk(null, versionInfoResponse)},
  };
};

const ownChannels = [
  {
    id: '700310x15441165x1',
    local_balance: 1000000,
    partner_public_key: bob,
    remote_balance: 4000000,
  },
  {
    id: '700310x15441165x3',
    local_balance: 1000000,
    partner_public_key: dave,
    remote_balance: 3000000,
  },
];

const makeArgs = overrides => {
  const args = {
    ask: ({source}, cbk) => cbk({id: source()[0].value}),
    channels: ownChannels,
    lnd: makeLnd({}),
    mtokens: '1000000',
    public_key: eve,
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({ask: undefined}),
    description: 'An ask function is required',
    error: [400, 'ExpectedAskFunctionToSelectBlindedPath'],
  },
  {
    args: makeArgs({channels: undefined}),
    description: 'Channels are required',
    error: [400, 'ExpectedArrayOfChannelsToSelectBlindedPath'],
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is required',
    error: [400, 'ExpectedAuthenticatedLndToSelectBlindedPath'],
  },
  {
    args: makeArgs({mtokens: undefined}),
    description: 'Millitokens are required',
    error: [400, 'ExpectedPaymentMillitokensToSelectBlindedPath'],
  },
  {
    args: makeArgs({public_key: 'key'}),
    description: 'The own public key is required',
    error: [400, 'ExpectedOwnPublicKeyToSelectBlindedPath'],
  },
  {
    args: makeArgs({max_hops: 1}),
    description: 'Max hops must allow for the peer and the own node',
    error: [400, 'ExpectedMaxHopsToAllowForPeerAndOwnNodeInPath'],
  },
  {
    args: makeArgs({channels: [ownChannels[1]]}),
    description: 'A peer with route blinding support is required',
    error: [400, 'NoRelevantChannelsToSelectAsEncryptedHints', {
      channels: [{
        id: '700310x15441165x3',
        issue: 'peer does not advertise route blinding support',
        peer: 'dave',
      }],
    }],
  },
  {
    args: makeArgs({
      channels: [ownChannels[0]],
      lnd: (() => {
        const lnd = makeLnd({});

        lnd.default.getChanInfo = ({chan_id}, cbk) => {
          return cbk(null, {...graph[chan_id], node1_policy: undefined});
        };

        return lnd;
      })(),
    }),
    description: 'A peer must have announced a policy for the channel',
    error: [400, 'NoRelevantChannelsToSelectAsEncryptedHints', {
      channels: [{
        id: '700310x15441165x1',
        issue: 'peer routing policy for the channel is unknown',
        peer: 'bob',
      }],
    }],
  },
  {
    args: makeArgs({channels: [ownChannels[0]], mtokens: '990000001'}),
    description: 'The amount must be within the peer HTLC limits',
    error: [400, 'NoRelevantChannelsToSelectAsEncryptedHints', {
      channels: [{
        id: '700310x15441165x1',
        issue: 'amount is above the peer maximum HTLC size',
        peer: 'bob',
      }],
    }],
  },
  {
    args: makeArgs({ask: ({}, cbk) => cbk({id: 'unknown'})}),
    description: 'A selected peer channel must be an offered channel',
    error: [400, 'ExpectedKnownChannelSelectedForBlindedPath'],
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(selectBlindedPath(args), error, 'Got expected error');
    } else {
      const res = await selectBlindedPath(args);

      deepEqual(res, expected, 'Got expected blinded path');
    }

    return;
  });
});

// Walking out from Bob to Carol and stopping makes Carol the introduction node
test('A path is selected outwards from a peer', async () => {
  const prompts = [];

  const answer = ({message, source}) => {
    const choices = source();

    prompts.push({
      message,
      choices: choices.map(n => n.name),
      disabled: choices.map(n => n.disabled),
    });

    // Eve selects Bob as the peer to receive through
    if (prompts.length === 1) {
      return choices.find(n => n.name.includes('bob')).value;
    }

    // Eve selects Carol as the node that relays to Bob
    if (prompts.length === 2) {
      return choices.find(n => n.name.includes('carol')).value;
    }

    // Eve ends the path at Carol
    return 'introduction_node';
  };

  const res = await selectBlindedPath(makeArgs({
    ask: (question, cbk) => cbk({id: answer(question)}),
  }));

  deepEqual(prompts.map(n => n.message), [
    'Peer to receive the payment through?',
    'Node that relays to bob?',
    'Node that relays to carol?',
  ],
  'Got expected prompts');

  deepEqual(prompts[0].choices, [
    '700310x15441165x1 bob: in: 0.04000000 | out: 0.01000000.',
    '700310x15441165x3 dave: in: 0.03000000 | out: 0.01000000.',
  ],
  'All peer channels are shown');

  deepEqual(prompts[0].disabled, [
    false,
    '(peer does not advertise route blinding support)',
  ],
  'Channels with peers that cannot relay are disabled with a reason');

  deepEqual(prompts[1].choices, [
    'Done: bob is the introduction node',
    '700310x15441165x2 carol: cap: 0.09000000 | fee: 1000 + 100ppm | cltv: 40',
  ],
  'Own node is excluded from the hops offered from Bob');

  deepEqual(prompts[2].choices, [
    'Done: carol is the introduction node',
  ],
  'Carol has no further channels to offer');

  deepEqual(res.introduction_node, carol, 'Carol is the introduction node');

  deepEqual(res.channels.map(n => n.id), [
    '700310x15441165x2',
    '700310x15441165x1',
  ],
  'Channels are ordered from the introduction node towards the own node');

  deepEqual(res.channels.map(n => n.policies.map(p => p.public_key)), [
    [bob, carol],
    [bob, eve],
  ],
  'Both policies of each channel are included');

  return;
});

// A maximum hops count stops the path from being extended further
test('A path is ended when it reaches the maximum hops', async () => {
  const prompts = [];

  const res = await selectBlindedPath(makeArgs({
    ask: ({message, source}, cbk) => {
      prompts.push({message, choices: source().map(n => n.value)});

      return cbk({id: source()[0].value});
    },
    max_hops: 2,
  }));

  deepEqual(prompts, [
    {
      choices: ['700310x15441165x1', '700310x15441165x3'],
      message: 'Peer to receive the payment through?',
    },
    {
      choices: ['introduction_node'],
      message: 'Path is at max length, end at bob?',
    },
  ],
  'Only ending the path is offered at the maximum hops');

  deepEqual(res.introduction_node, bob, 'The peer is the introduction node');
  deepEqual(res.channels.map(n => n.id), ['700310x15441165x1'], 'One hop');

  return;
});
