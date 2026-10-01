const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {createSignedRequest} = require('ln-service');
const {createUnsignedRequest} = require('ln-service');
const {paymentPathFromChannels} = require('bolt04');

const {probe} = require('./../../network');
const {getInfoResponse} = require('./../fixtures');
const {getNodeInfoResponse} = require('./../fixtures');
const {listChannelsResponse} = require('./../fixtures');
const {versionInfoResponse} = require('./../fixtures');

const alice = Buffer.alloc(33, 2).toString('hex');
const bob = '0324653eac434488002cc06bbfb7f10fe18991e35f9fe4302dbea6d23' +
  '53dc0ab1c';
const carol = Buffer.alloc(33, 4).toString('hex');
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

// A blinded path to Dave with Bob as the introduction node
const path = paymentPathFromChannels({
  channels: [{id: '700000x1x0', policies: [policy(bob), policy(dave)]}],
  cltv_delta: 80,
  current_block_height: 900000,
  destination: dave,
  id: Buffer.alloc(32, 1).toString('hex'),
  max_mtokens: '1000000',
});

// A request paying Dave through the blinded path
const {request} = (() => {
  const {hrp, tags} = createUnsignedRequest({
    cltv_delta: 80,
    created_at: '2026-01-01T00:00:00.000Z',
    description: 'blinded',
    expires_at: '2100-01-01T00:00:00.000Z',
    id: Buffer.alloc(32, 2).toString('hex'),
    network: 'bitcoin',
    paths: [path],
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

// Channels with peers, the route to the introduction node goes out with Bob
const channels = [
  {id: '1', key: bob},
  {id: '2', key: carol},
  {id: '3', key: alice},
];

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
      listChannels: ({}, cbk) => cbk(null, {
        channels: channels.map(({id, key}) => ({
          ...listChannelsResponse.channels[0],
          active: true,
          capacity: '2000000',
          chan_id: id,
          local_balance: '1000000',
          remote_balance: '1000000',
          remote_pubkey: key,
        })),
      }),
      queryRoutes: ({outgoing_chan_ids, pub_key}, cbk) => {
        // Only the introduction node is routable
        if (pub_key !== bob) {
          return cbk(null, {routes: []});
        }

        // The route to the introduction node goes out through Bob
        if (!!outgoing_chan_ids && !outgoing_chan_ids.includes('1')) {
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

// Probing the request reaches Bob, who forwards through the path to Dave
const probed = {
  blinded_path_fee: 2,
  id: undefined,
  paid: undefined,
  preimage: undefined,
  probed: 1000,
  relays: [bob, path.hops[1].relay_key],
  route_maximum: undefined,
  success: ['0x0x1', 'blinded'],
  total_fee: 2,
};

const tests = [
  {
    args: makeArgs({out_filters: ['outbound_liquidity > 0']}),
    description: 'Out filters require out peers to filter',
    error: [400, 'NoPeerMatchesFoundToSatisfyOutboundFilter'],
  },
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
  {
    args: makeArgs({}),
    description: 'A blinded path request is probed',
    expected: probed,
  },
  {
    args: makeArgs({out: [bob]}),
    description: 'A blinded path request is probed out through a peer',
    expected: probed,
  },
  {
    args: makeArgs({out: [bob, carol]}),
    description: 'A blinded path request is probed out through any out peer',
    expected: probed,
  },
  {
    args: makeArgs({out: [alice, carol]}),
    description: 'A probe fails when out peers have no route',
    expected: {attempted_paths: 0, is_failed: true},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(probe(args), error, 'Got expected error');
    } else {
      const {latency_ms, ...res} = await probe(args);

      deepEqual(res, expected, 'Got expected probe result');
    }

    return;
  });
});
