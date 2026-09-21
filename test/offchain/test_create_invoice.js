const EventEmitter = require('node:events');
const {createHash} = require('node:crypto');
const {deepEqual} = require('node:assert').strict;
const {equal} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {createSignedRequest} = require('ln-service');
const {createUnsignedRequest} = require('ln-service');
const {parsePaymentRequest} = require('ln-service');
const {pointFromScalar} = require('tiny-secp256k1');
const {sign} = require('tiny-secp256k1');

const createInvoice = require('./../../offchain/create_invoice');
const {chanInfoResponse} = require('./../fixtures');
const {getInfoResponse} = require('./../fixtures');
const {getNodeInfoResponse} = require('./../fixtures');
const {listChannelsResponse} = require('./../fixtures');
const {versionInfoResponse} = require('./../fixtures');

const bob = '0324653eac434488002cc06bbfb7f10fe18991e35f9fe4302dbea6d23' +
  '53dc0ab1c';
const carol = '027f31ebc5462c1fdce1b737ecff52d37d75dea43ce11c74d25aa2971' +
  '65faa2007';
const erin = '02eec7245d6b7d2ccb30380bfbe2a3648cd7a942653f5aa340edcea1f2' +
  '83686619';
const frank = '02edabbd16b41c8371b92ef2f04c1185b4f03b6dcd52ba9b78d9d7c89' +
  'c8f221145';
const ownKey = Buffer.alloc(32, 1);
const own = Buffer.from(pointFromScalar(ownKey, true)).toString('hex');

const aliases = {[bob]: 'bob', [carol]: 'carol', [erin]: 'erin'};
const blinding = {'25': {is_known: true, is_required: false, name: 'blind'}};
const bobErinChannel = '770000000000000003';
const carolBobChannel = '770000000000000002';
const createdAt = '2026-01-01T00:00:00.000Z';
const erinFrankChannel = '770000000000000004';
const expiresAt = '2100-01-01T00:00:00.000Z';
const ownCarolChannel = '770000000000000001';
const paymentAddr = Buffer.alloc(32, 3);
const secret = Buffer.alloc(32, 4);

const hash = createHash('sha256').update(secret).digest('hex');

const policy = {
  disabled: false,
  fee_base_msat: '1000',
  fee_rate_milli_msat: '100',
  last_update: 1700000000,
  max_htlc_msat: '990000000',
  min_htlc: '1',
  time_lock_delta: 40,
};

const channel = (id, capacity, node1, node2) => ({
  ...chanInfoResponse,
  capacity,
  channel_id: id,
  node1_pub: node1,
  node1_policy: policy,
  node2_pub: node2,
  node2_policy: policy,
});

// Own node - Carol - Bob - Erin - Frank
const graph = {
  [bobErinChannel]: channel(bobErinChannel, '8000000', bob, erin),
  [carolBobChannel]: channel(carolBobChannel, '9000000', bob, carol),
  [erinFrankChannel]: channel(erinFrankChannel, '7000000', erin, frank),
  [ownCarolChannel]: channel(ownCarolChannel, '5000000', carol, own),
};

// The channels of a node in the graph
const channelsOf = key => Object.values(graph).filter(channel => {
  return channel.node1_pub === key || channel.node2_pub === key;
});

// A regular LND invoice for the amount, signed by the own node key
const makeRequest = () => {
  const unsigned = createUnsignedRequest({
    cltv_delta: 80,
    created_at: createdAt,
    description: 'description',
    destination: own,
    expires_at: expiresAt,
    features: [{bit: 8}, {bit: 14}, {bit: 17}],
    id: hash,
    network: 'bitcoin',
    payment: paymentAddr.toString('hex'),
    tokens: 1000,
  });

  const signature = sign(Buffer.from(unsigned.hash, 'hex'), ownKey);

  return createSignedRequest({
    destination: own,
    hrp: unsigned.hrp,
    signature: Buffer.from(signature).toString('hex'),
    tags: unsigned.tags,
  });
};

const makeLnd = ({addInvoice}) => {
  return {
    chain: {
      registerBlockEpochNtfn: ({}) => {
        const emitter = new EventEmitter();

        emitter.cancel = () => {};

        process.nextTick(() => emitter.emit('error', 'err'));

        return emitter;
      },
    },
    default: {
      addInvoice: (args, cbk) => {
        if (!!addInvoice) {
          addInvoice(args);
        }

        return cbk(null, {
          add_index: '1',
          payment_addr: paymentAddr,
          payment_request: makeRequest().request,
          r_hash: Buffer.from(hash, 'hex'),
        });
      },
      getChanInfo: ({chan_id}, cbk) => cbk(null, graph[chan_id]),
      getInfo: ({}, cbk) => {
        return cbk(null, {
          ...getInfoResponse,
          block_height: 900000,
          identity_pubkey: own,
        });
      },
      getNodeInfo: ({include_channels, pub_key}, cbk) => {
        const channels = channelsOf(pub_key);

        return cbk(null, {
          ...getNodeInfoResponse,
          channels: !!include_channels ? channels : [],
          node: {
            ...getNodeInfoResponse.node,
            alias: aliases[pub_key] || 'frank',
            features: blinding,
            pub_key,
          },
          num_channels: String(channels.length),
        });
      },
      listChannels: ({}, cbk) => {
        return cbk(null, {
          channels: [{
            ...listChannelsResponse.channels[0],
            capacity: '5000000',
            chan_id: ownCarolChannel,
            local_balance: '1000000',
            private: false,
            remote_balance: '4000000',
            remote_pubkey: carol,
          }],
        });
      },
      lookupInvoice: ({}, cbk) => {
        return cbk(null, {
          creation_date: '1700000000',
          description_hash: Buffer.alloc(0),
          expiry: '86400',
          features: {},
          htlcs: [],
          memo: 'description',
          payment_addr: paymentAddr,
          payment_request: makeRequest().request,
          r_hash: Buffer.from(hash, 'hex'),
          r_preimage: secret,
          settled: false,
          value: '1000',
          value_msat: '1000000',
        });
      },
    },
    version: {getVersion: ({}, cbk) => cbk(null, versionInfoResponse)},
  };
};

// Answer the path selection: peer Carol, then Bob, then Bob is introduction
const selectPath = ({source}, cbk) => {
  const choices = source();

  const bobChannel = choices.find(n => n.name.includes('bob'));

  return cbk({id: !!bobChannel ? bobChannel.value : choices[0].value});
};

const makeArgs = overrides => {
  const args = {
    amount: '1000',
    ask: selectPath,
    description: 'description',
    is_encrypting_hints: true,
    is_selecting_hops: true,
    lnd: makeLnd({}),
    logger: {error: () => {}, info: () => {}},
    request: () => {},
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({is_hinting: true, is_selecting_hops: undefined}),
    description: 'Default hints cannot be combined with encrypted hints',
    error: [400, 'CannotUseDefaultHintsAndAlsoEncryptedHints'],
  },
  {
    args: makeArgs({is_selecting_hops: undefined, is_virtual: true}),
    description: 'Virtual channels cannot be combined with encrypted hints',
    error: [400, 'EncryptedHintsUnsupportedWithVirtualChannels'],
  },
  {
    args: makeArgs({amount: '0'}),
    description: 'Encrypted hints require an amount',
    error: [400, 'ExpectedNonZeroInvoiceAmountForEncryptedHints'],
  },
  {
    args: makeArgs({is_selecting_hops: undefined, virtual_fee_rate: 1000}),
    description: 'A receiver fee rate needs a virtual channel or a path',
    error: [400, 'ExpectedVirtualChannelOrSelectedPathForFeeRate'],
  },
  {
    args: makeArgs({
      lnd: (() => {
        const lnd = makeLnd({});

        lnd.default.listChannels = ({}, cbk) => cbk(null, {channels: []});

        return lnd;
      })(),
    }),
    description: 'Encrypted hints selection requires active channels',
    error: [400, 'NoActiveChannelsToSelectAsEncryptedHints'],
  },
];

tests.forEach(({args, description, error}) => {
  return test(description, async () => {
    await rejects(createInvoice(args), error, 'Got expected error');

    return;
  });
});

// Without selecting hops, LND is asked to create the blinded paths itself
test('LND creates blinded paths when hints are not selected', async () => {
  const invoices = [];

  const res = await createInvoice(makeArgs({
    is_selecting_hops: undefined,
    lnd: makeLnd({addInvoice: args => invoices.push(args)}),
  }));

  const [invoice] = invoices;

  equal(invoice.is_blinded, true, 'LND is asked for blinded paths');
  equal(invoice.private, false, 'No private channel hints are requested');
  equal(invoice.value_msat, '1000000', 'Amount is passed to LND');

  equal(res.request.request, makeRequest().request, 'LND request returned');
  equal(res.request.tokens, 1000, 'Got expected tokens');

  return;
});

// Selecting hints with encrypted hints builds a blinded path to the node
test('A selected blinded path is added to the request', async () => {
  const invoices = [];
  const prompts = [];

  const res = await createInvoice(makeArgs({
    ask: (question, cbk) => {
      prompts.push(question.message);

      return selectPath(question, cbk);
    },
    lnd: makeLnd({addInvoice: args => invoices.push(args)}),
  }));

  const [invoice] = invoices;

  equal(invoice.is_blinded, false, 'LND does not make the blinded paths');

  deepEqual(prompts, [
    'Peer to receive the payment through?',
    'Node that relays to carol?',
    'Node that relays to bob?',
  ],
  'Got expected path selection prompts');

  const parsed = parsePaymentRequest({request: res.request.request});

  equal(res.request.tokens, 1000, 'Got expected tokens');
  equal(parsed.tokens, 1000, 'Request is for the invoice amount');
  equal(parsed.id, hash, 'Request is for the LND invoice hash');
  equal(parsed.cltv_delta, 80, 'Request uses the LND final cltv delta');
  equal(parsed.description, 'description', 'Request has the description');
  equal(parsed.expires_at, expiresAt, 'Request expires with the LND invoice');
  equal(parsed.destination !== own, true, 'The node key is not revealed');
  equal(parsed.payment, undefined, 'No payment identifier in the request');
  equal(parsed.routes, undefined, 'No hop hints in the request');

  deepEqual(parsed.features.map(n => n.bit), [8, 17, 262], 'Features');

  const [path] = parsed.paths;

  equal(parsed.paths.length, 1, 'A single blinded path is included');
  equal(path.introduction_node, bob, 'Bob is the introduction node');
  equal(path.hops.length, 4, 'Path has Bob, Carol, own node and padding');
  equal(path.hops[0].relay_key, bob, 'The first hop is the introduction');
  equal(path.cltv_delta, 160, 'Path cltv adds relay deltas to final delta');
  equal(path.base_fee_mtokens, '2001', 'Path base fee is the accumulated fee');
  equal(path.fee_rate, 201, 'Path fee rate is the accumulated rate');
  equal(path.max_htlc_mtokens, '1000000', 'Path max is the invoice amount');
  equal(path.min_htlc_mtokens, '1', 'Path min is the largest relay minimum');

  return;
});

// A selected path longer than the minimum hops count is not padded or refused
test('A long selected blinded path is not padded', async () => {
  const prompts = [];

  // Walk own node - Carol - Bob - Erin - Frank, with Frank as introduction
  const answer = ({source}) => {
    const choices = source();
    const next = ['carol', 'bob', 'erin', 'frank'][prompts.length];

    prompts.push(choices.map(n => n.name));

    const choice = choices.find(n => n.name.includes(`${next}:`));

    return !!choice ? choice.value : 'introduction_node';
  };

  const res = await createInvoice(makeArgs({
    ask: (question, cbk) => cbk({id: answer(question)}),
  }));

  const parsed = parsePaymentRequest({request: res.request.request});

  const [path] = parsed.paths;

  equal(prompts.length, 5, 'Peer, three hops outwards, then done');
  equal(path.introduction_node, frank, 'Frank is the introduction node');
  equal(path.hops.length, 5, 'Frank, Erin, Bob, Carol and own node hops');
  equal(path.cltv_delta, 240, 'Four relaying hops add to the final delta');

  return;
});

// A receiver fee rate is charged by a padding hop on the blinded path
test('A receiver fee is added to a selected blinded path', async () => {
  const res = await createInvoice(makeArgs({virtual_fee_rate: 1000}));

  const [path] = parsePaymentRequest({request: res.request.request}).paths;

  equal(path.hops.length, 4, 'The path is padded to the minimum hops');
  equal(path.base_fee_mtokens, '2001', 'Relay base fees are unchanged');
  equal(path.fee_rate, 1202, 'The receiver fee rate compounds the relay rates');
  equal(path.cltv_delta, 160, 'The receiver fee hop adds no cltv delta');

  return;
});

// A receiver fee takes a padding hop, so the path is capped a hop shorter
test('A receiver fee path is capped to fit in the request', async () => {
  const prompts = [];

  // Try to walk own node - Carol - Bob - Erin - Frank
  const answer = ({message, source}) => {
    const choices = source();
    const next = ['carol', 'bob', 'erin', 'frank'][prompts.length];

    prompts.push(message);

    const choice = choices.find(n => n.name.includes(`${next}:`));

    return !!choice ? choice.value : 'introduction_node';
  };

  const res = await createInvoice(makeArgs({
    ask: (question, cbk) => cbk({id: answer(question)}),
    virtual_fee_rate: 1000,
  }));

  const [path] = parsePaymentRequest({request: res.request.request}).paths;

  deepEqual(prompts, [
    'Peer to receive the payment through?',
    'Node that relays to carol?',
    'Node that relays to bob?',
    'Path is at max length, end at erin?',
  ],
  'The path cannot be extended to Frank when a receiver fee takes a hop');

  equal(path.introduction_node, erin, 'Erin is the introduction node');
  equal(path.hops.length, 5, 'Four real hops and a padding hop for the fee');
  equal(path.cltv_delta, 200, 'Three relaying hops add to the final delta');

  return;
});
