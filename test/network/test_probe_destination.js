const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {createSignedRequest} = require('ln-service');
const {createUnsignedRequest} = require('ln-service');
const {gray} = require('colorette');
const {greenBright} = require('colorette');
const moment = require('moment');
const {paymentPathFromChannels} = require('bolt04');

const probeDestination = require('./../../network/probe_destination');
const {getInfoResponse} = require('./../fixtures');
const {getNodeInfoResponse} = require('./../fixtures');
const {listChannelsResponse} = require('./../fixtures');
const {listPeersResponse} = require('./../fixtures');
const {versionInfoResponse} = require('./../fixtures');

const bob = '0324653eac434488002cc06bbfb7f10fe18991e35f9fe4302dbea6d23' +
  '53dc0ab1c';
const carol = '027f31ebc5462c1fdce1b737ecff52d37d75dea43ce11c74d25aa2971' +
  '65faa2007';
const dave = '032c0b7cf95324a07d05398b240174dc0c2be444d96b159aa6c7f7b1e6' +
  '68680991';

const expiresAt = '2100-01-01T00:00:00.000Z';
const height = 900000;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
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
    expires_at: expiresAt,
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

// The amount delivered to the introduction node includes the path fee
const introductionMtokens = BigInt(tokens * 1e3) + pathFeeMtokens;

// Logs for the request, the probe check, and the route evaluation
const decodedLog = {
  info: {
    id,
    tokens,
    description: 'blinded',
    destination: 'blinded',
    expires: moment(expiresAt).fromNow(),
  },
};

const checkingLog = {
  info: {
    blinded_path_fee: pathFee,
    checking_for_path_to_introduction: `bob ${bob}`,
  },
};

const evaluatingLog = {
  info: {
    evaluating: [
      `${gray('0x0x1')} ★ ★ ★ ★`,
      `${greenBright('bob')} ${bob}. Fee rate: 0.00% (0)`,
    ],
  },
};

const payingLog = {info: {paying: ['0x0x1', 'blinded', 'blinded']}};

// A probe route goes to the introduction node and carries the path fee
const probeRoute = {
  hops: [{
    amt_to_forward: (tokens + pathFee).toString(),
    amt_to_forward_msat: introductionMtokens.toString(),
    chan_id: '1',
    expiry: height + 200,
    fee: '0',
    fee_msat: '0',
    pub_key: bob,
    tlv_payload: true,
  }],
  total_amt: (tokens + pathFee).toString(),
  total_amt_msat: introductionMtokens.toString(),
  total_fees: '0',
  total_fees_msat: '0',
  total_time_lock: height + 200,
};

// A payment route continues from the introduction node into the blinded path
const paymentRoute = {
  hops: [
    {
      amt_to_forward: '0',
      amt_to_forward_msat: '0',
      blinding_point: hexAsBuffer(path.key),
      chan_id: '1',
      encrypted_data: hexAsBuffer(path.hops[0].encrypted_data),
      expiry: 0,
      fee: pathFee.toString(),
      fee_msat: pathFeeMtokens.toString(),
      pub_key: bob,
      tlv_payload: true,
    },
    {
      amt_to_forward: '0',
      amt_to_forward_msat: '0',
      chan_id: '0',
      encrypted_data: hexAsBuffer(path.hops[1].encrypted_data),
      expiry: 0,
      fee: '0',
      fee_msat: '0',
      pub_key: path.hops[1].relay_key,
      tlv_payload: true,
    },
    {
      amt_to_forward: tokens.toString(),
      amt_to_forward_msat: (tokens * 1e3).toString(),
      chan_id: '0',
      encrypted_data: hexAsBuffer(path.hops[2].encrypted_data),
      expiry: height + 40,
      fee: '0',
      fee_msat: '0',
      pub_key: path.hops[2].relay_key,
      tlv_payload: true,
      total_amt_msat: (tokens * 1e3).toString(),
    },
  ],
  total_amt: (tokens + pathFee).toString(),
  total_amt_msat: introductionMtokens.toString(),
  total_fees: pathFee.toString(),
  total_fees_msat: pathFeeMtokens.toString(),
  total_time_lock: height + 200,
};

// The result of reaching the destination through the blinded path
const reached = {
  blinded_path_fee: pathFee,
  fee: pathFee,
  id: undefined,
  route_maximum: undefined,
  paid: undefined,
  preimage: undefined,
  probed: tokens,
  relays: [bob, path.hops[1].relay_key, path.hops[2].relay_key],
  success: ['0x0x1', 'blinded', 'blinded'],
};

const [channel] = listChannelsResponse.channels;

// Out channels for a single peer: 1 is small, 2 is medium, 3 is large
const outChannels = [
  {...channel, chan_id: '1', local_balance: '1000000'},
  {...channel, chan_id: '2', local_balance: '3000000'},
  {...channel, chan_id: '3', local_balance: '5000000'},
].map(n => ({...n, active: true, remote_pubkey: bob}));

// A logger that keeps a record of everything logged, in order
const makeLogger = () => {
  const logs = [];

  return {
    logs,
    error: error => logs.push({error}),
    info: info => logs.push({info}),
  };
};

const makeLnd = ({channels, routes}) => {
  const queried = [];
  const sent = [];

  return {
    queried,
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
      listChannels: ({}, cbk) => cbk(null, {channels: channels || []}),
      listPeers: ({}, cbk) => cbk(null, listPeersResponse),
      queryRoutes: ({outgoing_chan_ids, pub_key}, cbk) => {
        queried.push(outgoing_chan_ids);

        // Only the introduction node is routable
        if (pub_key !== bob) {
          return cbk(null, {routes: []});
        }

        return cbk(null, {
          routes: routes || [introductionRoute],
          success_prob: 1,
        });
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
    logger: makeLogger(),
    max_fee: 1337,
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

// Probe out through the single peer that has the small, medium, large channels
const makeOutArgs = overrides => {
  const args = makeArgs({
    tokens,
    destination: bob,
    lnd: makeLnd({channels: outChannels, routes: []}),
    out_through: [bob],
    request: undefined,
  });

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
  {
    args: makeArgs({out_through: bob}),
    description: 'Out through peers must be an array',
    error: [400, 'ExpectedArrayOfOutThroughPeersToProbe'],
  },
  {
    args: makeArgs({find_max: 16777215, out_through: [bob, carol]}),
    description: 'The maximum cannot be found through multiple out peers',
    error: [501, 'FindMaxNotSupportedWithMultipleOutThroughPeers'],
  },
  {
    args: makeArgs({}),
    description: 'A blinded path request is probed to the introduction node',
    expected: reached,
    logs: [decodedLog, checkingLog, evaluatingLog],
    sent: [probeRoute],
  },
  {
    args: makeArgs({is_real_payment: true}),
    description: 'A blinded path request is paid along the extended route',
    expected: {
      ...reached,
      id,
      paid: tokens + pathFee,
      preimage: secret.toString('hex'),
      probed: undefined,
    },
    logs: [decodedLog, checkingLog, payingLog, evaluatingLog],
    sent: [probeRoute, paymentRoute],
  },
  {
    args: makeOutArgs({}),
    description: 'Without a maximum, the smallest channel that fits is used',
    expected: {attempted_paths: 0, is_failed: true},
    queried: [['1']],
  },
  {
    args: makeOutArgs({find_max: 2000000}),
    description: 'The smallest channel that can send the maximum is used',
    expected: {attempted_paths: 0, is_failed: true},
    queried: [['2']],
  },
  {
    args: makeOutArgs({find_max: 10000000}),
    description: 'The largest channel is used when none can send the maximum',
    expected: {attempted_paths: 0, is_failed: true},
    queried: [['3']],
  },
];

tests.forEach(({args, description, error, expected, logs, queried, sent}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(probeDestination(args), error, 'Got expected error');
    } else {
      const {latency_ms, ...res} = await probeDestination(args);

      deepEqual(res, expected, 'Got expected probe result');
    }

    if (!!logs) {
      deepEqual(args.logger.logs, logs, 'Got expected logs');
    }

    if (!!queried) {
      deepEqual(args.lnd.queried, queried, 'Got expected out channels');
    }

    if (!!sent) {
      deepEqual(args.lnd.sent, sent, 'Got expected routes sent');
    }

    return;
  });
});
