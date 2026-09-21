const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const selectNextHop = require('./../../offchain/select_next_hop');
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

const aliases = {[bob]: 'bob', [carol]: 'carol', [dave]: 'dave'};
const blinding = {'25': {is_known: true, is_required: false, name: 'blind'}};
const disabled = {disabled: true, fee_base_msat: '1', fee_rate_milli_msat: '1'};

const policy = {
  disabled: false,
  fee_base_msat: '1000',
  fee_rate_milli_msat: '100',
  last_update: 1700000000,
  max_htlc_msat: '990000000',
  min_htlc: '1',
  time_lock_delta: 40,
};

// Carol has channels with Bob, Dave (no route blinding) and Eve (disabled)
const channels = [
  {
    ...chanInfoResponse,
    capacity: '9000000',
    channel_id: '770000000000000002',
    node1_pub: bob,
    node1_policy: policy,
    node2_pub: carol,
    node2_policy: policy,
  },
  {
    ...chanInfoResponse,
    capacity: '8000000',
    channel_id: '770000000000000003',
    node1_pub: carol,
    node1_policy: policy,
    node2_pub: dave,
    node2_policy: policy,
  },
  {
    ...chanInfoResponse,
    capacity: '7000000',
    channel_id: '770000000000000004',
    node1_pub: carol,
    node1_policy: policy,
    node2_pub: eve,
    node2_policy: {...policy, ...disabled},
  },
];

const makeLnd = ({}) => {
  return {
    default: {
      getNodeInfo: ({include_channels, pub_key}, cbk) => {
        const node = {
          ...getNodeInfoResponse.node,
          alias: aliases[pub_key] || 'eve',
          features: pub_key === dave ? {} : blinding,
          pub_key,
        };

        return cbk(null, {
          ...getNodeInfoResponse,
          node,
          channels: !!include_channels ? channels : [],
          num_channels: String(channels.length),
        });
      },
    },
    version: {getVersion: ({}, cbk) => cbk(null, versionInfoResponse)},
  };
};

const makeArgs = overrides => {
  const args = {
    ask: ({source}, cbk) => cbk({id: source()[1].value}),
    excluded: [],
    lnd: makeLnd({}),
    mtokens: '1000000',
    node: {alias: 'carol', public_key: carol},
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({ask: undefined}),
    description: 'An ask function is required',
    error: [400, 'ExpectedAskFunctionToSelectNextHop'],
  },
  {
    args: makeArgs({excluded: undefined}),
    description: 'Excluded nodes are required',
    error: [400, 'ExpectedExcludedNodesToSelectNextHop'],
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is required',
    error: [400, 'ExpectedAuthenticatedLndToSelectNextHop'],
  },
  {
    args: makeArgs({mtokens: undefined}),
    description: 'Millitokens are required',
    error: [400, 'ExpectedPaymentMillitokensToSelectNextHop'],
  },
  {
    args: makeArgs({node: {}}),
    description: 'A last node public key is required',
    error: [400, 'ExpectedLastNodePublicKeyToSelectNextHop'],
  },
  {
    args: makeArgs({ask: ({}, cbk) => cbk({id: 'unknown'})}),
    description: 'A selected channel must be an offered channel',
    error: [400, 'ExpectedKnownChannelSelectedForNextHop'],
  },
  {
    args: makeArgs({}),
    description: 'A relaying node is selected',
    expected: {
      hop: {
        alias: 'bob',
        channel: {
          capacity: 9000000,
          id: '700310x15441165x2',
          policies: [
            {
              base_fee_mtokens: '1000',
              cltv_delta: 40,
              fee_rate: 100,
              inbound_base_discount_mtokens: '0',
              inbound_rate_discount: 0,
              is_disabled: false,
              max_htlc_mtokens: '990000000',
              min_htlc_mtokens: '1',
              public_key: bob,
              updated_at: '2023-11-14T22:13:20.000Z',
            },
            {
              base_fee_mtokens: '1000',
              cltv_delta: 40,
              fee_rate: 100,
              inbound_base_discount_mtokens: '0',
              inbound_rate_discount: 0,
              is_disabled: false,
              max_htlc_mtokens: '990000000',
              min_htlc_mtokens: '1',
              public_key: carol,
              updated_at: '2023-11-14T22:13:20.000Z',
            },
          ],
          transaction_id: '1',
          transaction_vout: 1,
          updated_at: '2023-11-14T22:13:20.000Z',
        },
        public_key: bob,
      },
    },
  },
  {
    args: makeArgs({ask: ({source}, cbk) => cbk({id: source()[0].value})}),
    description: 'The last node is selected as the introduction node',
    expected: {},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(selectNextHop(args), error, 'Got expected error');
    } else {
      const res = await selectNextHop(args);

      deepEqual(res, expected, 'Got expected next hop');
    }

    return;
  });
});

// Only nodes supporting route blinding with relaying policies are offered
test('Offered hops exclude unusable nodes', async () => {
  const offered = [];

  await selectNextHop(makeArgs({
    ask: ({message, source, type}, cbk) => {
      offered.push({message, type, choices: source()});

      return cbk({id: source()[0].value});
    },
  }));

  const [{choices, message, type}] = offered;

  deepEqual(type, 'search', 'Hops are selected with a search prompt');
  deepEqual(message, 'Node that relays to carol?', 'Got expected message');

  deepEqual(choices.map(n => n.value), [
    'introduction_node',
    '700310x15441165x2',
  ],
  'Only done and the route blinding relay with a policy are offered');

  deepEqual(choices[0].name, 'Done: carol is the introduction node', 'Done');

  deepEqual(
    choices[1].name,
    '700310x15441165x2 bob: cap: 0.09000000 | fee: 1000 + 100ppm | cltv: 40',
    'Got expected hop description'
  );

  deepEqual(choices[1].description, bob, 'The node key is the description');

  return;
});

// Nodes that are already on the path are not offered again
test('Excluded nodes are not offered', async () => {
  let choices;

  const res = await selectNextHop(makeArgs({
    ask: ({source}, cbk) => {
      choices = source();

      return cbk({id: source()[0].value});
    },
    excluded: [bob],
  }));

  deepEqual(choices.map(n => n.value), ['introduction_node'], 'Only done');
  deepEqual(res, {}, 'The path ends when there are no more nodes to add');

  return;
});

// The search source filters choices by the search term
test('Search filters offered hops', async () => {
  let filtered;

  await selectNextHop(makeArgs({
    ask: ({source}, cbk) => {
      filtered = {
        byAlias: source('BOB').map(n => n.value),
        byKey: source(bob.slice(0, 8)).map(n => n.value),
        none: source('zzz').map(n => n.value),
      };

      return cbk({id: source()[0].value});
    },
  }));

  deepEqual(filtered.byAlias, ['700310x15441165x2'], 'Filter by alias');
  deepEqual(filtered.byKey, ['700310x15441165x2'], 'Filter by public key');
  deepEqual(filtered.none, [], 'No matches for unknown term');

  return;
});

// A path at its maximum length can only be ended at the last node
test('A max length path offers only the introduction node', async () => {
  let prompt;

  const res = await selectNextHop(makeArgs({
    ask: (question, cbk) => {
      prompt = question;

      return cbk({id: question.source()[0].value});
    },
    is_max_length: true,
  }));

  deepEqual(prompt.message, 'Path is at max length, end at carol?', 'Msg');
  deepEqual(prompt.source().map(n => n.value), ['introduction_node'], 'End');
  deepEqual(res, {}, 'The path ends at the last node');

  return;
});
