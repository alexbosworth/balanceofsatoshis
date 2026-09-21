const {deepEqual} = require('node:assert').strict;
const {equal} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {parsePaymentRequest} = require('ln-service');
const {paymentPathFromChannels} = require('bolt04');

const signPaymentRequest = require('./../../offchain/sign_payment_request');

const bob = '0324653eac434488002cc06bbfb7f10fe18991e35f9fe4302dbea6d23' +
  '53dc0ab1c';
const carol = '027f31ebc5462c1fdce1b737ecff52d37d75dea43ce11c74d25aa2971' +
  '65faa2007';
const dave = '032c0b7cf95324a07d05398b240174dc0c2be444d96b159aa6c7f7b1e6' +
  '68680991';

const policy = key => ({
  base_fee_mtokens: '1000',
  cltv_delta: 40,
  fee_rate: 100,
  max_htlc_mtokens: '990000000',
  min_htlc_mtokens: '1000',
  public_key: key,
});

// Dave receives through Carol, with Bob as the introduction node
const path = paymentPathFromChannels({
  channels: [
    {id: '700000x1x0', policies: [policy(bob), policy(carol)]},
    {id: '700001x2x1', policies: [policy(carol), policy(dave)]},
  ],
  cltv_delta: 80,
  current_block_height: 900000,
  destination: dave,
  id: Buffer.alloc(32, 1).toString('hex'),
  max_mtokens: '1000000',
});

// A path that is padded to too many hops does not fit in a request field
const longPath = paymentPathFromChannels({
  channels: [
    {id: '700000x1x0', policies: [policy(bob), policy(carol)]},
    {id: '700001x2x1', policies: [policy(carol), policy(dave)]},
  ],
  cltv_delta: 80,
  current_block_height: 900000,
  destination: dave,
  hop_count: 7,
  id: Buffer.alloc(32, 1).toString('hex'),
  max_mtokens: '1000000',
});

const makeArgs = overrides => {
  const args = {
    channels: [],
    cltv_delta: 80,
    description: 'description',
    destination: dave,
    expires_at: '2100-01-01T00:00:00.000Z',
    features: [{bit: 8}, {bit: 17}, {bit: 262}],
    id: Buffer.alloc(32, 2).toString('hex'),
    lnd: {},
    network: 'bitcoin',
    paths: [path],
    tokens: 1000,
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({paths: 'paths'}),
    description: 'Blinded paths must be an array',
    error: [400, 'ExpectedArrayOfBlindedPathsToSignPaymentRequest'],
  },
  {
    args: makeArgs({is_virtual: true}),
    description: 'Blinded paths cannot be used with a virtual channel',
    error: [400, 'ExpectedNoVirtualChannelWithBlindedPathsToSign'],
  },
  {
    args: makeArgs({paths: undefined}),
    description: 'A payment nonce is required without blinded paths',
    error: [400, 'ExpectedPaymentNonceToSignPaymentRequest'],
  },
  {
    args: makeArgs({paths: [longPath]}),
    description: 'A blinded path must fit within a payment request field',
    error: [400, 'BlindedPathTooLongToEncodeInPaymentRequest'],
  },
];

tests.forEach(({args, description, error}) => {
  return test(description, async () => {
    await rejects(signPaymentRequest(args), error, 'Got expected error');

    return;
  });
});

// A request with blinded paths hides the destination behind an ephemeral key
test('A blinded paths request is signed with an ephemeral key', async () => {
  const {request, tokens} = await signPaymentRequest(makeArgs({}));

  const parsed = parsePaymentRequest({request});

  equal(tokens, 1000, 'Got expected tokens');
  equal(parsed.tokens, 1000, 'Request has expected tokens');
  equal(parsed.id, Buffer.alloc(32, 2).toString('hex'), 'Got payment hash');
  equal(parsed.cltv_delta, 80, 'Got final cltv delta');
  equal(parsed.description, 'description', 'Got description');
  equal(parsed.expires_at, '2100-01-01T00:00:00.000Z', 'Got expiry');
  equal(parsed.destination !== dave, true, 'Destination is not the node');
  equal(parsed.payment, undefined, 'No payment identifier is in the request');
  equal(parsed.routes, undefined, 'No hop hints are in the request');

  deepEqual(parsed.features.map(n => n.bit), [8, 17, 262], 'Got features');

  // In the request the introduction node hop is keyed by its unblinded key
  const [introduction, ...hops] = path.hops;

  deepEqual(parsed.paths, [{
    base_fee_mtokens: path.base_fee_mtokens,
    cltv_delta: path.cltv_delta,
    features: [],
    fee_rate: path.fee_rate,
    hops: [{encrypted_data: introduction.encrypted_data, relay_key: bob}]
      .concat(hops),
    introduction_node: bob,
    key: path.key,
    max_htlc_mtokens: path.max_htlc_mtokens,
    min_htlc_mtokens: path.min_htlc_mtokens,
  }],
  'Got expected blinded path');

  return;
});
