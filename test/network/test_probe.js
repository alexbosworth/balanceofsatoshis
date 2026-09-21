const {equal} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {createSignedRequest} = require('ln-service');
const {createUnsignedRequest} = require('ln-service');
const {paymentPathFromChannels} = require('bolt04');

const {probe} = require('./../../network');
const {getInfoResponse} = require('./../fixtures');
const {getNodeInfoResponse} = require('./../fixtures');
const {versionInfoResponse} = require('./../fixtures');

const bob = '0324653eac434488002cc06bbfb7f10fe18991e35f9fe4302dbea6d23' +
  '53dc0ab1c';
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

// A request paying Dave through a blinded path with Bob as introduction node
const {request} = (() => {
  const {hrp, tags} = createUnsignedRequest({
    cltv_delta: 80,
    created_at: '2026-01-01T00:00:00.000Z',
    description: 'blinded',
    expires_at: '2100-01-01T00:00:00.000Z',
    id: Buffer.alloc(32, 2).toString('hex'),
    network: 'bitcoin',
    paths: [paymentPathFromChannels({
      channels: [{id: '700000x1x0', policies: [policy(bob), policy(dave)]}],
      cltv_delta: 80,
      current_block_height: 900000,
      destination: dave,
      id: Buffer.alloc(32, 1).toString('hex'),
      max_mtokens: '1000000',
    })],
    tokens: 1000,
  });

  return createSignedRequest({hrp, tags});
})();

// A route from the payer to Bob, the introduction node, delivering path fees
const introductionRoute = {
  hops: [{
    amt_to_forward_msat: '1002202',
    chan_id: '1',
    custom_records: {},
    expiry: 900200,
    fee_msat: '0',
    pub_key: bob,
  }],
  total_amt: '1000',
  total_amt_msat: '1002202',
  total_fees: '0',
  total_fees_msat: '0',
  total_time_lock: 900200,
};

const makeLnd = ({}) => {
  return {
    default: {
      deletePayment: ({}, cbk) => cbk(),
      getInfo: ({}, cbk) => {
        return cbk(null, {...getInfoResponse, block_height: 900000});
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
        // A route into the blinded path is a payment that succeeds
        if (route.hops.some(n => !!n.encrypted_data)) {
          return cbk(null, {preimage: Buffer.alloc(32, 7)});
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
    avoid: [],
    lnd: makeLnd({}),
    logger: {error: () => {}, info: () => {}},
    max_fee: 10,
    max_paths: 1,
    out: [],
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({find_max: 16777215}),
    description: 'Finding the maximum is not supported to blinded paths',
    error: [501, 'MultiPathProbeNotSupportedWithBlindedPaths'],
  },
  {
    args: makeArgs({max_paths: 2}),
    description: 'Multi-path probes are not supported to blinded paths',
    error: [501, 'MultiPathProbeNotSupportedWithBlindedPaths'],
  },
];

tests.forEach(({args, description, error}) => {
  return test(description, async () => {
    await rejects(probe(args), error, 'Got expected error');

    return;
  });
});

// Probing a blinded path request reports the total fee and the path fee
test('A blinded path request is probed', async () => {
  const res = await probe(makeArgs({}));

  equal(res.fee, undefined, 'The fee is shown as the total fee');
  equal(res.total_fee, 2, 'The total fee includes the blinded path fee');
  equal(res.blinded_path_fee, 2, 'The blinded path fee is the path cost');
  equal(res.probed, 1000, 'The probe delivered the request amount');

  return;
});
