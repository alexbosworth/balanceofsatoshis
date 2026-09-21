const {deepEqual} = require('node:assert').strict;
const {equal} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {createSignedRequest} = require('ln-service');
const {createUnsignedRequest} = require('ln-service');
const {paymentPathFromChannels} = require('bolt04');

const probeDestination = require('./../../network/probe_destination');
const {getInfoResponse} = require('./../fixtures');
const {getNodeInfoResponse} = require('./../fixtures');
const {versionInfoResponse} = require('./../fixtures');

const bob = '0324653eac434488002cc06bbfb7f10fe18991e35f9fe4302dbea6d23' +
  '53dc0ab1c';
const carol = '027f31ebc5462c1fdce1b737ecff52d37d75dea43ce11c74d25aa2971' +
  '65faa2007';
const dave = '032c0b7cf95324a07d05398b240174dc0c2be444d96b159aa6c7f7b1e6' +
  '68680991';

const height = 900000;
const id = Buffer.alloc(32, 2).toString('hex');
const secret = Buffer.alloc(32, 7);
const tokens = 1000;

const policy = key => ({
  base_fee_mtokens: '1000',
  cltv_delta: 40,
  fee_rate: 100,
  max_htlc_mtokens: '990000000',
  min_htlc_mtokens: '1000',
  public_key: key,
});

// Dave is paid through Carol, Bob is the introduction node
const path = paymentPathFromChannels({
  channels: [
    {id: '700000x1x0', policies: [policy(bob), policy(carol)]},
    {id: '700001x2x1', policies: [policy(carol), policy(dave)]},
  ],
  cltv_delta: 80,
  current_block_height: height,
  destination: dave,
  id: Buffer.alloc(32, 1).toString('hex'),
  max_mtokens: '1000000',
});

const {request} = (() => {
  const {hrp, tags} = createUnsignedRequest({
    cltv_delta: 80,
    created_at: '2026-01-01T00:00:00.000Z',
    description: 'blinded',
    expires_at: '2100-01-01T00:00:00.000Z',
    features: [{bit: 8}, {bit: 17}, {bit: 262}],
    id,
    network: 'bitcoin',
    paths: [path],
    tokens,
  });

  return createSignedRequest({hrp, tags});
})();

// The path fee for the amount: 2001 base plus 201 ppm of 1000000 mtokens
const pathFeeMtokens = BigInt(path.base_fee_mtokens) +
  BigInt(path.fee_rate) * BigInt(tokens * 1e3) / BigInt(1e6);

// The path fee in tokens is rounded down: 2202 mtokens is 2 tokens
const pathFee = Number(pathFeeMtokens / BigInt(1e3));

// A route from the payer to Bob, the introduction node, delivering path fees
const introductionRoute = {
  hops: [{
    amt_to_forward_msat: (BigInt(tokens * 1e3) + pathFeeMtokens).toString(),
    chan_id: '1',
    custom_records: {},
    expiry: height + 200,
    fee_msat: '0',
    pub_key: bob,
  }],
  total_amt: tokens.toString(),
  total_amt_msat: (BigInt(tokens * 1e3) + pathFeeMtokens).toString(),
  total_fees: '0',
  total_fees_msat: '0',
  total_time_lock: height + 200,
};

const makeLnd = ({}) => {
  const sent = [];

  return {
    sent,
    default: {
      deletePayment: ({}, cbk) => cbk(),
      getInfo: ({}, cbk) => {
        return cbk(null, {...getInfoResponse, block_height: height});
      },
      getNodeInfo: ({pub_key}, cbk) => {
        // Only the introduction node is a known node
        if (pub_key !== bob) {
          return cbk({details: 'unable to find node'});
        }

        return cbk(null, {
          ...getNodeInfoResponse,
          channels: [],
          node: {...getNodeInfoResponse.node, alias: 'bob', pub_key},
          num_channels: '0',
        });
      },
      queryRoutes: ({pub_key}, cbk) => {
        // Only the introduction node is routable
        if (pub_key !== bob) {
          return cbk(null, {routes: []});
        }

        return cbk(null, {routes: [introductionRoute], success_prob: 1});
      },
    },
    router: {
      sendToRouteV2: ({route}, cbk) => {
        sent.push(route);

        // A route into the blinded path is a payment that succeeds
        if (route.hops.some(n => !!n.encrypted_data)) {
          return cbk(null, {preimage: secret});
        }

        // A probe route to the introduction node fails at the final hop
        return cbk(null, {
          failure: {
            chan_id: '1',
            code: 'INCORRECT_OR_UNKNOWN_PAYMENT_DETAILS',
            failure_source_index: route.hops.length,
          },
          preimage: Buffer.alloc(Number()),
        });
      },
    },
    version: {getVersion: ({}, cbk) => cbk(null, versionInfoResponse)},
  };
};

const makeArgs = overrides => {
  const args = {
    request,
    lnd: makeLnd({}),
    logger: {error: () => {}, info: () => {}},
    max_fee: 1337,
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({message: 'message'}),
    description: 'Messages cannot be attached to blinded path payments',
    error: [501, 'MessagesNotSupportedWithBlindedPaths'],
  },
  {
    args: makeArgs({find_max: 16777215}),
    description: 'The maximum cannot be found through blinded paths',
    error: [501, 'FindMaxNotSupportedWithBlindedPaths'],
  },
];

tests.forEach(({args, description, error}) => {
  return test(description, async () => {
    await rejects(probeDestination(args), error, 'Got expected error');

    return;
  });
});

// Probing a request with blinded paths probes to the introduction node
test('A blinded path request is probed', async () => {
  const logs = [];
  const lnd = makeLnd({});

  const res = await probeDestination(makeArgs({
    lnd,
    logger: {error: () => {}, info: log => logs.push(log)},
  }));

  const [decoded, checking] = logs;

  equal(decoded.destination, 'blinded', 'The destination is not known');
  equal(decoded.tokens, tokens, 'Request amount is logged');

  deepEqual(
    checking,
    {
      blinded_path_fee: pathFee,
      checking_for_path_to_introduction: `bob ${bob}`,
    },
    'The probe is described as going to the introduction node with the fee'
  );

  equal(lnd.sent.length, 1, 'A single probe route was attempted');
  equal(lnd.sent[0].hops.length, 1, 'The probe went to the introduction');
  equal(lnd.sent[0].hops[0].pub_key, bob, 'The probe hop is Bob');

  equal(res.fee, pathFee, 'Fee to the destination includes the path fee');
  equal(res.blinded_path_fee, pathFee, 'The blinded path fee is reported');
  equal(res.probed, tokens, 'The probe delivered the invoice amount');
  equal(res.latency_ms !== undefined, true, 'Latency is reported');
  equal(res.paid, undefined, 'Nothing was paid');

  deepEqual(res.relays, [bob, path.hops[1].relay_key, path.hops[2].relay_key],
    'The route continues into the blinded hops');

  deepEqual(res.success, ['0x0x1', 'blinded', 'blinded'], 'Blinded hops');

  return;
});

// Paying a request with blinded paths pays the extended route
test('A blinded path request is paid', async () => {
  const lnd = makeLnd({});

  const res = await probeDestination(makeArgs({lnd, is_real_payment: true}));

  const [probe, payment] = lnd.sent;

  equal(lnd.sent.length, 2, 'A probe and then a payment were sent');
  equal(probe.hops.length, 1, 'The probe went to the introduction node');
  equal(payment.hops.length, 3, 'The payment went into the blinded path');

  const [introduction, relay, final] = payment.hops;

  equal(introduction.pub_key, bob, 'Payment first hop is the introduction');
  equal(!!introduction.blinding_point, true, 'Introduction gets path key');
  equal(!!introduction.encrypted_data, true, 'Introduction gets its data');
  equal(!!relay.encrypted_data, true, 'Relay gets encrypted data');
  equal(relay.blinding_point, undefined, 'Relay gets no path key');
  equal(final.total_amt_msat, '1000000', 'Final hop gets the total amount');
  equal(final.mpp_record, undefined, 'Final hop has no payment identifier');

  equal(res.id, id, 'Payment hash is returned');
  equal(res.paid, tokens + pathFee, 'The amount plus the path fee was paid');
  equal(res.preimage, secret.toString('hex'), 'The preimage is returned');
  equal(res.fee, pathFee, 'The fee includes the blinded path fee');
  equal(res.blinded_path_fee, pathFee, 'The blinded path fee is reported');

  return;
});
