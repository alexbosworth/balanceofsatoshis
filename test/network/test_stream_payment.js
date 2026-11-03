const {createHash} = require('crypto');
const {deepEqual} = require('node:assert').strict;
const EventEmitter = require('events');
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {bech32} = require('bech32');
const {createSignedRequest} = require('ln-service');
const {createUnsignedRequest} = require('ln-service');
const {pointFromScalar} = require('tiny-secp256k1');
const {sign} = require('tiny-secp256k1');

const {getInfoResponse} = require('./../fixtures');
const {getNodeInfoResponse} = require('./../fixtures');
const {listChannelsResponse} = require('./../fixtures');
const streamPayment = require('./../../network/stream_payment');

const bufferAsHex = buffer => Buffer.from(buffer).toString('hex');
const callbackUrl = 'https://example.com/callback';
const colorCodes = /\\u001b\[\d+m/g;
const height = 900000;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const hrp = request => request.slice(Number(), request.lastIndexOf('1'));
const key = Buffer.alloc(32, 1);
const metadata = '[["text/plain","streaming"]]';
const {nextTick} = process;
const noRoute = {details: 'unable to find a path to destination'};
const notUrl = bech32.encode('lnurl', bech32.toWords(Buffer.from('nope')));
const {parse} = JSON;
const peers = [3, 4, 5, 6, 7, 8, 9].map(n => `03${'0'.repeat(63)}${n}`);
const rejected = 'FAILURE_REASON_INCORRECT_PAYMENT_DETAILS';
const sha256 = n => createHash('sha256').update(n).digest('hex');
const {stringify} = JSON;
const termsUrl = 'https://example.com/.well-known/lnurlp/alice';
const unroutable = 'FAILURE_REASON_NO_ROUTE';

const alice = bufferAsHex(pointFromScalar(key, true));
const bob = bufferAsHex(Buffer.alloc(33, 2));
const hrpOfRequest = (k, v) => k === 'payment_request' ? hrp(v) : v;
const payment = bufferAsHex(Buffer.alloc(32, 3));
const proof = bufferAsHex(Buffer.alloc(32, 7));

const asShown = n => parse(stringify(n).replace(colorCodes, ''), hrpOfRequest);

// Make a payment request from alice for an amount
const makeRequest = ({id, mtokens}) => {
  const unsigned = createUnsignedRequest({
    id,
    mtokens,
    payment,
    cltv_delta: 40,
    description_hash: sha256(Buffer.from(metadata, 'utf8')),
    destination: alice,
    expires_at: '2100-01-01T00:00:00.000Z',
    features: [{bit: 8}, {bit: 14}, {bit: 17}],
    network: 'bitcoin',
  });

  const signature = sign(hexAsBuffer(unsigned.hash), key);

  return createSignedRequest({
    destination: alice,
    hrp: unsigned.hrp,
    signature: bufferAsHex(signature),
    tags: unsigned.tags,
  }).request;
};

// Note that LND is called when any one of the methods of LND is called
const noteCalls = ({methods, noted}) => Object.keys(methods).forEach(name => {
  const method = methods[name];

  methods[name] = (...params) => {
    noted.is_lnd_called = true;

    return method(...params);
  };
});

// Make the LNURL service of alice, it can decline amounts above a limit
const makeService = args => {
  return ({qs, url}, cbk) => {
    // The service notes every request made to it
    args.noted.requested.push(url);

    // Exit early when asked for the terms, the max is a JSON number
    if (url === termsUrl) {
      return cbk(null, {}, {
        metadata,
        callback: callbackUrl,
        maxSendable: parse(args.max_sendable || '200000000'),
        minSendable: parse(args.min_sendable || '1000'),
        tag: 'payRequest',
      });
    }

    // Exit early when the service cannot be reached
    if (!!args.is_failing) {
      return cbk('err');
    }

    // Exit early when the service declines to make the invoice
    if (!!args.limit && BigInt(qs.amount) > BigInt(args.limit)) {
      return cbk(null, {}, {reason: 'amount too large', status: 'ERROR'});
    }

    const id = bufferAsHex(Buffer.alloc(32, args.invoices.length + 1));

    args.invoices.push(id);

    return cbk(null, {}, {pr: makeRequest({id, mtokens: qs.amount})});
  };
};

// A payment as LND tracks it, it settled unless there is a failure reason
const rpcPayment = ({id, reason, route}) => {
  const value = BigInt(route.total_amt_msat) - BigInt(route.total_fees_msat);

  return {
    creation_date: '1',
    creation_time_ns: '1000000000',
    failure_reason: reason || 'FAILURE_REASON_NONE',
    fee_msat: route.total_fees_msat,
    fee_sat: '0',
    htlcs: [{
      route,
      attempt_id: '1',
      attempt_time_ns: '1000000000',
      failure: null,
      preimage: hexAsBuffer(proof),
      resolve_time_ns: '2000000000',
      status: !reason ? 'SUCCEEDED' : 'FAILED',
    }],
    path: [alice],
    payment_hash: id,
    payment_index: '1',
    payment_preimage: proof,
    payment_request: String(),
    status: !reason ? 'SUCCEEDED' : 'FAILED',
    value: String(value / BigInt(1e3)),
    value_msat: String(value),
    value_sat: String(value / BigInt(1e3)),
  };
};

// Make a LND with a channel to alice, or to bob when routes go via bob
const makeLnd = args => {
  const aliases = {[alice]: 'alice', [bob]: 'bob'};
  const fails = (args.fails || []).slice();
  let found = Number();
  const lookups = [];
  const payments = {};
  let raised = Number();
  let routes = args.routes;
  const spent = [];

  const firstHop = args.via || alice;

  // There are channels to the peers, or to the first hop when there are none
  const peerKeys = args.peers || [firstHop];

  // A peer can go offline once a payment went out through the channel to it
  const isOffline = id => !!args.is_going_offline && spent.includes(id);

  // A channel can be closed once a payment went out through it
  const isClosed = id => !!args.is_closing && spent.includes(id);

  // The channel from bob to alice comes after the channels to the peers
  const forward = String(peerKeys.length + 1);

  // Bob charges a base fee of one token and a fee rate of one per million
  const feeFor = (n, via) => {
    return !via ? BigInt(0) : BigInt(1e3) + BigInt(n) / BigInt(1e6);
  };

  // Routes go to alice directly or via bob, out through an allowed channel
  const firstHopFor = ids => {
    // Exit early when routes can go out through any channel
    if (!ids) {
      return firstHop;
    }

    return ids
      .map(id => peerKeys[Number(id) - 1])
      .find(key => key === alice || key === args.via);
  };

  // The policy of a channel, only the channel from bob to alice has fees
  const policy = id => ({
    disabled: false,
    fee_base_msat: id === forward ? String(1000 + raised) : '0',
    fee_rate_milli_msat: id === forward ? '1' : '0',
    last_update: 1,
    max_htlc_msat: args.max_htlc || '150000000',
    min_htlc: '1',
    time_lock_delta: 40,
  });

  // The route to alice for an amount, directly or via a peer
  const routeFor = (mtokens, via) => {
    const fee = feeFor(mtokens, via);
    const keys = [via, alice].filter(n => !!n);

    const total = BigInt(mtokens) + fee;

    return {
      hops: keys.map((key, i) => ({
        amt_to_forward_msat: mtokens,
        chan_id: !i ? String(peerKeys.indexOf(key) + 1) : forward,
        custom_records: {},
        expiry: height + 40 * (keys.length - i),
        fee_msat: key === alice ? '0' : fee.toString(),
        pub_key: key,
        tlv_payload: true,
      })),
      total_amt: String(total / BigInt(1e3)),
      total_amt_msat: total.toString(),
      total_fees: String(fee / BigInt(1e3)),
      total_fees_msat: fee.toString(),
      total_time_lock: height + 40 * keys.length,
    };
  };

  const lnd = {
    default: {
      deletePayment: ({}, cbk) => cbk(),
      getChanInfo: ({chan_id}, cbk) => {
        const isForward = chan_id === forward;

        // Bob's channel is looked up before and after a route is evaluated
        const isAfter = isForward && lookups.includes(found);

        if (isForward) {
          lookups.push(found);
        }

        // Bob raises his fee while some of the routes found are evaluated
        if (isAfter && (args.fee_changes || []).includes(found)) {
          raised++;
        }

        return cbk(null, {
          capacity: '1000000',
          chan_point: '1:1',
          channel_id: chan_id,
          node1_policy: policy(chan_id),
          node1_pub: isForward ? bob : getInfoResponse.identity_pubkey,
          node2_policy: policy(chan_id),
          node2_pub: isForward ? alice : peerKeys[Number(chan_id) - 1],
        });
      },
      getInfo: ({}, cbk) => {
        return cbk(null, {...getInfoResponse, block_height: height});
      },
      // Node details arrive after a delay, as they do from a real node
      getNodeInfo: ({pub_key}, cbk) => setImmediate(() => cbk(null, {
        ...getNodeInfoResponse,
        channels: [],
        node: {
          ...getNodeInfoResponse.node,
          pub_key,
          alias: aliases[pub_key] || 'peer',
        },
        num_channels: '0',
      })),
      // Outbound liquidity is lower on a channel once a payment went out on it
      listChannels: ({}, cbk) => cbk(null, {
        channels: peerKeys
          .map((key, i) => ({
            ...listChannelsResponse.channels[0],
            active: !args.is_inactive && !isOffline(String(i + 1)),
            capacity: '1000000',
            chan_id: String(i + 1),
            local_balance: spent.includes(String(i + 1)) ? '100000' : '900000',
            remote_balance: '100000',
            remote_pubkey: key,
          }))
          .filter(n => !isClosed(n.chan_id)),
      }),
      queryRoutes: (query, cbk) => {
        const hop = firstHopFor(query.outgoing_chan_ids);
        const ignored = query.ignored_nodes.map(n => bufferAsHex(n));
        const maxFee = BigInt(query.fee_limit.fixed_msat);

        const via = hop === alice ? undefined : hop;

        const isAvoided = !!via && ignored.includes(via);
        const isOverMaxFee = feeFor(query.amt_msat, via) > maxFee;

        // Exit early when there is no route left within the limits
        if (!hop || routes === 0 || isAvoided || isOverMaxFee) {
          return cbk(noRoute);
        }

        found++;

        // A limited number of routes runs out as the routes are found
        routes = routes === undefined ? routes : routes - 1;

        return cbk(null, {routes: [routeFor(query.amt_msat, via)]});
      },
    },
    router: {
      // A route of two hops goes via the first hop on to alice
      buildRoute: ({amt_msat, hop_pubkeys}, cbk) => {
        const [relay] = hop_pubkeys.length > 1 ? hop_pubkeys : [];

        return cbk(null, {
          route: routeFor(amt_msat, !relay ? undefined : bufferAsHex(relay)),
        });
      },
      sendToRouteV2: ({payment_hash, route}, cbk) => {
        const [finalHop] = route.hops.slice().reverse();
        const id = bufferAsHex(payment_hash);

        // A probe is to a hash that is unknown at the destination
        if (!args.invoices.includes(id)) {
          const address = bufferAsHex(finalHop.mpp_record.payment_addr);

          // Probes are counted by the payment address that they carry
          args.noted.probes[address] = (args.noted.probes[address] || 0) + 1;

          return cbk(null, {
            failure: {
              code: 'INCORRECT_OR_UNKNOWN_PAYMENT_DETAILS',
              failure_source_index: route.hops.length,
            },
            preimage: Buffer.alloc(Number()),
          });
        }

        const fail = fails.shift() || {};

        // A payment can fail on the way or be rejected at the destination
        if (!!fail.code) {
          const isRejected = fail.index === route.hops.length;

          const reason = isRejected ? rejected : unroutable;

          payments[id] = rpcPayment({id, reason, route});

          return cbk(null, {
            failure: {code: fail.code, failure_source_index: fail.index},
            preimage: Buffer.alloc(Number()),
          });
        }

        payments[id] = rpcPayment({id, route});

        const [outHop] = route.hops;

        // The payment takes liquidity from the channel it went out through
        spent.push(outHop.chan_id);

        // The reply to a payment can be lost even though the payment settled
        if (!!args.is_reply_lost) {
          return cbk({details: 'ConnectionDropped'});
        }

        return cbk(null, {preimage: hexAsBuffer(proof)});
      },
      trackPaymentV2: ({payment_hash}) => {
        const emitter = new EventEmitter();
        const tracked = payments[bufferAsHex(payment_hash)];

        // Tracking a payment can be canceled
        emitter.cancel = () => {};

        // Exit early when LND has no payment to the hash
        if (!tracked) {
          nextTick(() => emitter.emit('error', {
            details: `payment isn't initiated`,
          }));

          return emitter;
        }

        nextTick(() => emitter.emit('data', tracked));

        return emitter;
      },
    },
  };

  // Calls to any of the methods of LND are noted
  noteCalls({methods: lnd.default, noted: args.noted});
  noteCalls({methods: lnd.router, noted: args.noted});

  return lnd;
};

// Make the arguments to stream to alice, with LND and the service set up, and
// with what is logged and what is asked of LND and of the service noted
const makeArgs = ({network, service, ...overrides}) => {
  const invoices = [];
  const noted = {is_lnd_called: false, logs: [], probes: {}, requested: []};

  const args = {
    noted,
    amount: '250*k',
    avoid: [],
    fs: {getFile: (path, cbk) => cbk('err')},
    lnd: makeLnd({invoices, noted, ...network}),
    lnurl: 'alice@example.com',
    logger: {
      error: err => noted.logs.push({err}),
      info: line => noted.logs.push(line),
    },
    max_fee: '1337',
    max_fee_rate: 1000,
    out: [],
    request: makeService({invoices, noted, ...service}),
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

// Make what is expected to be noted, by default nothing is logged or asked for
const makeExpected = overrides => {
  const expected = {is_lnd_called: false, logs: [], probes: {}, requested: []};

  Object.keys(overrides).forEach(k => expected[k] = overrides[k]);

  return expected;
};

// Make file system methods that read a tags file
const withTags = tags => ({
  getFile: (path, cbk) => cbk(null, stringify({tags})),
});

// Alice is tagged as a friend
const friends = withTags([{
  alias: 'friends',
  icon: '🐢',
  id: bufferAsHex(Buffer.alloc(32)),
  nodes: [alice],
}]);

// Bob and a peer are friends, and friends are also always avoided
const avoidedFriends = withTags([{
  alias: 'friends',
  icon: '🐢',
  id: bufferAsHex(Buffer.alloc(32)),
  is_avoided: true,
  nodes: [bob, peers[0]],
}]);

// Bob is tagged as slow, and slow nodes are always avoided
const avoidedSlow = withTags([{
  alias: 'slow',
  icon: '🐌',
  id: bufferAsHex(Buffer.alloc(32)),
  is_avoided: true,
  nodes: [bob],
}]);

// Routes as they are described when they are evaluated or paid through
const direct = ['0x0x1 ', `alice ${alice}. Fee rate: 0.00% (0)`];
const tagged = ['0x0x1 ', `🐢 alice ${alice}. Fee rate: 0.00% (0)`];
const viaBob = rate => [
  '0x0x1 ',
  `bob ${bob}. Fee rate: 0.00% (${rate})`,
  '0x0x2x0',
];

// With alice and bob as out peers, routes via bob go out on a second channel
const outViaBob = [
  '0x0x2 ',
  `bob ${bob}. Fee rate: 0.00% (11)`,
  '0x0x3x0',
];

// Routes out through bob when bob is tagged with an icon
const outViaTagged = icon => [
  '0x0x1 ',
  `${icon} bob ${bob}. Fee rate: 0.00% (11)`,
  '0x0x3x0',
];

// A payment fails at bob, who has too little liquidity to forward to alice
const atBob = {code: 'TEMPORARY_CHANNEL_FAILURE', index: 1};
const failedAtBob = {
  failure: 'TemporaryChannelFailure from bob on 0x0x2 forwarding to alice',
};

// The line that starts a stream of 250k to alice, with the default limits
const start = {
  description: 'streaming',
  max_fee: '0.00001337',
  max_fee_rate: 1000,
  max_payment: '0.00200000',
  min_payment: '0.00100000',
  service_max_sendable: '0.00200000',
  streaming: '0.00250000',
};

const tests = [
  {
    args: makeArgs({amount: undefined}),
    description: 'An amount is required',
    error: [400, 'ExpectedAmountToStreamPayment'],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({amount: 'amount'}),
    description: 'A parseable amount is required',
    error: [400, 'FailedToParseAmountToStreamPayment'],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({amount: '0'}),
    description: 'A positive amount is checked before asking the service',
    error: [400, 'ExpectedPositiveAmountToStreamPayment'],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({amount: '1000'}),
    description: 'An amount of at least a minimum payment is required',
    error: [400, 'ExpectedAmountAtLeastMinimumPayment', {minimum: 100000}],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({avoid: undefined}),
    description: 'An avoid array is required',
    error: [400, 'ExpectedAvoidArrayToStreamPayment'],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({fs: undefined}),
    description: 'File system methods are required',
    error: [400, 'ExpectedFileSystemMethodsToStreamPayment'],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is required',
    error: [400, 'ExpectedAuthenticatedLndToStreamPayment'],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({lnurl: undefined}),
    description: 'A lnurl or lightning address is required',
    error: [400, 'ExpectedLnurlOrLightningAddressToStreamTo'],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({lnurl: 'lnurl'}),
    description: 'A valid lnurl or lightning address is required',
    error: [400, 'ExpectedValidLnurlOrLightningAddress'],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({lnurl: notUrl}),
    description: 'A lnurl has to hold a valid URL',
    error: [400, 'ExpectedValidLnurlOrLightningAddress'],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({lnurl: 'Alice@example.com'}),
    description: 'A lightning address has to be valid',
    error: [400, 'ExpectedValidLnurlOrLightningAddress'],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({logger: undefined}),
    description: 'A logger is required',
    error: [400, 'ExpectedWinstonLoggerToStreamPayment'],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({max_fee: undefined}),
    description: 'A max fee is required',
    error: [400, 'ExpectedMaxFeeToStreamPayment'],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({max_fee: 'max_fee'}),
    description: 'A parseable max fee is required',
    error: [400, 'FailedToParseMaxFeeToStreamPayment'],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({max_fee: '-1'}),
    description: 'A max fee cannot be negative',
    error: [400, 'ExpectedNonNegativeMaxFeeToStreamPayment'],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({max_fee_rate: undefined}),
    description: 'A max fee rate is required',
    error: [400, 'ExpectedMaxFeeRateToStreamPayment'],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({max_fee_rate: -1}),
    description: 'A max fee rate cannot be negative',
    error: [400, 'ExpectedMaxFeeRateToStreamPayment'],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({max_payment: 'max_payment'}),
    description: 'A parseable max payment is required',
    error: [400, 'FailedToParseMaxPaymentToStreamPayment'],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({max_payment: '0'}),
    description: 'A positive max payment is checked before asking the service',
    error: [400, 'ExpectedPositiveMaxPaymentToStreamPayment'],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({max_payment: '1000'}),
    description: 'A max payment of at least a minimum payment is required',
    error: [400, 'ExpectedMaxPaymentAtLeastMinPayment', {minimum: 100000}],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({
      amount: '250*k',
      service: {max_sendable: '500000000', min_sendable: '300000000'},
    }),
    description: 'An amount of at least the service minimum is required',
    error: [400, 'ExpectedAmountAtLeastServiceMinSendable', {minimum: 300000}],
    expected: makeExpected({is_lnd_called: true, requested: [termsUrl]}),
  },
  {
    args: makeArgs({
      amount: '1*m',
      max_payment: '200*k',
      service: {max_sendable: '500000000', min_sendable: '300000000'},
    }),
    description: 'A max payment of at least the service minimum is required',
    error: [400, 'ExpectedMaxPaymentAtLeastServiceMinSendable', {
      minimum: 300000,
    }],
    expected: makeExpected({is_lnd_called: true, requested: [termsUrl]}),
  },
  {
    args: makeArgs({min_payment: 'min_payment'}),
    description: 'A parseable min payment is required',
    error: [400, 'FailedToParseMinPaymentToStreamPayment'],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({min_payment: '0'}),
    description: 'A positive min payment is checked before asking the service',
    error: [400, 'ExpectedPositiveMinPaymentToStreamPayment'],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({amount: '500*k', min_payment: '300*k'}),
    description: 'A min payment must fit within the service max',
    error: [400, 'ServiceMaxSendableBelowMinPayment', {
      max: 200000,
      minimum: 300000,
    }],
    expected: makeExpected({is_lnd_called: true, requested: [termsUrl]}),
  },
  {
    args: makeArgs({out: undefined}),
    description: 'An out array is required',
    error: [400, 'ExpectedArrayOfOutPeersToStreamPayment'],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({network: {is_inactive: true}, out: [alice]}),
    description: 'An out peer needs an active channel',
    error: [404, 'NoActiveChannelWithOutgoingPeer'],
    expected: makeExpected({is_lnd_called: true, requested: [termsUrl]}),
  },
  {
    args: makeArgs({out: ['nobody']}),
    description: 'An out peer alias has to match a peer before streaming',
    error: [400, 'FailedToFindPeerAliasMatch', {not_found: 'nobody'}],
    expected: makeExpected({is_lnd_called: true, requested: [termsUrl]}),
  },
  {
    args: makeArgs({network: {peers: peers.slice(0, 2)}, out: ['peer']}),
    description: 'An out peer alias has to match one peer before streaming',
    error: [400, 'AmbiguousAliasSpecified', {
      matching: [
        {alias: 'peer', public_key: peers[0]},
        {alias: 'peer', public_key: peers[1]},
      ],
    }],
    expected: makeExpected({is_lnd_called: true, requested: [termsUrl]}),
  },
  {
    args: makeArgs({out_filters: 'OUTBOUND_LIQUIDITY > 0'}),
    description: 'Out filters must be an array',
    error: [400, 'ExpectedArrayOfOutFiltersToStreamPayment'],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({out_filters: ['OUTBOUND_LIQUIDITY > 0']}),
    description: 'Out filters need out peers to filter',
    error: [400, 'NoPeerMatchesFoundToSatisfyOutboundFilter'],
    expected: makeExpected({is_lnd_called: true, requested: [termsUrl]}),
  },
  {
    args: makeArgs({request: undefined}),
    description: 'A request function is required',
    error: [400, 'ExpectedRequestFunctionToStreamPayment'],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({service: {max_sendable: '1e400'}}),
    description: 'A service max that is not a safe integer is not used',
    error: [503, 'ExpectedSafeIntegerSendableLimitsFromService'],
    expected: makeExpected({is_lnd_called: true, requested: [termsUrl]}),
  },
  {
    args: makeArgs({}),
    description: 'A payment is streamed in a series of payments',
    expected: makeExpected({
      is_lnd_called: true,
      logs: [
        start,
        // The first invoice is for the most that the service takes
        {requesting_invoice: '0.00200000'},
        {payment_request: 'lnbc2m'},
        // A route is found and then the most it carries is evaluated
        {evaluating: direct},
        {evaluating_amount: '0.00100000'},
        {evaluating_amount: '0.00150000'},
        // The route carries less than the invoice so there is a new invoice
        {requesting_invoice: '0.00150000'},
        {payment_request: 'lnbc1500u'},
        {amount: '0.00150000', paying: direct},
        {proof, paid: '0.00150000'},
        // What is left fits in one more payment
        {evaluating: direct},
        {evaluating_amount: '0.00100000'},
        {requesting_invoice: '0.00100000'},
        {payment_request: 'lnbc1m'},
        {amount: '0.00100000', paying: direct},
        {proof, paid: '0.00100000'},
      ],
      probes: {[payment]: 5},
      requested: [termsUrl, callbackUrl, callbackUrl, callbackUrl],
      summary: {
        payments: [
          {proof, paid: '0.00150000', path: direct},
          {proof, paid: '0.00100000', path: direct},
        ],
        total_paid: '0.00250000',
      },
    }),
  },
  {
    args: makeArgs({max_fee: '5*k', network: {via: bob}}),
    description: 'Fees show rounded up and are left out of what was paid',
    expected: makeExpected({
      is_lnd_called: true,
      logs: [
        {...start, max_fee: '0.00005000'},
        {requesting_invoice: '0.00200000'},
        {payment_request: 'lnbc2m'},
        {evaluating: viaBob(11)},
        {evaluating_amount: '0.00100000'},
        {evaluating_amount: '0.00150000'},
        {requesting_invoice: '0.00150000'},
        {payment_request: 'lnbc1500u'},
        {amount: '0.00150000', paying: viaBob(7)},
        // Bob charges 1.15 tokens to forward 150k, which rounds up to 2
        {proof, fee: '0.00000002', paid: '0.00150000'},
        {evaluating: viaBob(11)},
        {evaluating_amount: '0.00100000'},
        {requesting_invoice: '0.00100000'},
        {payment_request: 'lnbc1m'},
        {amount: '0.00100000', paying: viaBob(11)},
        // Bob charges 1.1 tokens to forward 100k
        {proof, fee: '0.00000002', paid: '0.00100000'},
      ],
      probes: {[payment]: 5},
      requested: [termsUrl, callbackUrl, callbackUrl, callbackUrl],
      summary: {
        payments: [
          {proof, fee: '0.00000002', paid: '0.00150000', path: viaBob(7)},
          {proof, fee: '0.00000002', paid: '0.00100000', path: viaBob(11)},
        ],
        // 2.25 tokens of fees were paid in total, which round up to 3
        total_fee_rate: '9',
        total_fees: '0.00000003',
        total_paid: '0.00250000',
      },
    }),
  },
  {
    args: makeArgs({amount: '100*k', max_fee: '1', network: {via: bob}}),
    description: 'A max fee below the max fee rate becomes the fee rate',
    error: [503, 'NoRouteFound', {fee_mtokens: '0', mtokens: '0'}],
    expected: makeExpected({
      is_lnd_called: true,
      logs: [
        // A max fee of 1 for 100k is a fee rate of 10 per million
        {
          ...start,
          max_fee: '0.00000001',
          max_fee_rate: 10,
          streaming: '0.00100000',
        },
        {requesting_invoice: '0.00100000'},
        {payment_request: 'lnbc1m'},
        // Bob charges 1.1 tokens to forward 100k, more than the max fee
        {
          no_route_found: {
            amount: '0.00100000',
            max_fee: '0.00000001',
            routes_tried: 0,
          },
        },
      ],
      requested: [termsUrl, callbackUrl],
    }),
  },
  {
    args: makeArgs({amount: '100*k', max_fee: '0', network: {via: bob}}),
    description: 'A max fee of zero is shown as zero',
    error: [503, 'NoRouteFound', {fee_mtokens: '0', mtokens: '0'}],
    expected: makeExpected({
      is_lnd_called: true,
      logs: [
        {
          ...start,
          max_fee: '0.00000000',
          max_fee_rate: 0,
          streaming: '0.00100000',
        },
        {requesting_invoice: '0.00100000'},
        {payment_request: 'lnbc1m'},
        {
          no_route_found: {
            amount: '0.00100000',
            max_fee: '0.00000000',
            routes_tried: 0,
          },
        },
      ],
      requested: [termsUrl, callbackUrl],
    }),
  },
  {
    args: makeArgs({
      amount: '100*k',
      network: {
        // The destination is at index 1, past the one hop out to alice
        fails: [{code: 'INCORRECT_OR_UNKNOWN_PAYMENT_DETAILS', index: 1}],
      },
    }),
    description: 'A payment that alice rejects is paid with a new invoice',
    expected: makeExpected({
      is_lnd_called: true,
      logs: [
        {...start, streaming: '0.00100000'},
        {requesting_invoice: '0.00100000'},
        {payment_request: 'lnbc1m'},
        {evaluating: direct},
        {evaluating_amount: '0.00100000'},
        {amount: '0.00100000', paying: direct},
        // Alice rejects the payment so a new invoice is asked for
        {failure: 'UnknownPaymentHash from alice'},
        {evaluating: direct},
        {evaluating_amount: '0.00100000'},
        {requesting_invoice: '0.00100000'},
        {payment_request: 'lnbc1m'},
        {amount: '0.00100000', paying: direct},
        {proof, paid: '0.00100000'},
      ],
      probes: {[payment]: 4},
      requested: [termsUrl, callbackUrl, callbackUrl],
      summary: {
        payments: [{proof, paid: '0.00100000', path: direct}],
        total_paid: '0.00100000',
      },
    }),
  },
  {
    args: makeArgs({
      amount: '100*k',
      network: {fails: [atBob], routes: 1, via: bob},
    }),
    description: 'A failure on the way is shown before the stream ends',
    error: [503, 'NoRouteFound', {fee_mtokens: '0', mtokens: '0'}],
    expected: makeExpected({
      is_lnd_called: true,
      logs: [
        {...start, streaming: '0.00100000'},
        {requesting_invoice: '0.00100000'},
        {payment_request: 'lnbc1m'},
        {evaluating: viaBob(11)},
        {evaluating_amount: '0.00100000'},
        {amount: '0.00100000', paying: viaBob(11)},
        // Aliases are looked up after a delay, the failure is still shown
        failedAtBob,
        {
          no_route_found: {
            amount: '0.00100000',
            max_fee: '0.00000100',
            routes_tried: 0,
          },
        },
      ],
      probes: {[payment]: 2},
      requested: [termsUrl, callbackUrl],
    }),
  },
  {
    args: makeArgs({
      amount: '200*k',
      network: {
        // The first payment settles, then payments keep failing at bob
        fails: [{}, atBob, atBob, atBob],
        max_htlc: '100000000',
        via: bob,
      },
    }),
    description: 'Payments that keep failing end the stream after a summary',
    error: [503, 'TooManyFailedPayments', {
      fee_mtokens: '1100',
      mtokens: '100000000',
    }],
    expected: makeExpected({
      is_lnd_called: true,
      logs: [
        {...start, streaming: '0.00200000'},
        {requesting_invoice: '0.00200000'},
        {payment_request: 'lnbc2m'},
        {evaluating: viaBob(11)},
        {evaluating_amount: '0.00100000'},
        {requesting_invoice: '0.00100000'},
        {payment_request: 'lnbc1m'},
        {amount: '0.00100000', paying: viaBob(11)},
        {proof, fee: '0.00000002', paid: '0.00100000'},
        // Probes find a route each time but the payments fail at bob
        {evaluating: viaBob(11)},
        {evaluating_amount: '0.00100000'},
        {requesting_invoice: '0.00100000'},
        {payment_request: 'lnbc1m'},
        {amount: '0.00100000', paying: viaBob(11)},
        failedAtBob,
        {evaluating: viaBob(11)},
        {evaluating_amount: '0.00100000'},
        {amount: '0.00100000', paying: viaBob(11)},
        failedAtBob,
        {evaluating: viaBob(11)},
        {evaluating_amount: '0.00100000'},
        {amount: '0.00100000', paying: viaBob(11)},
        failedAtBob,
        // The third failure in a row ends the stream, after what was paid
        {
          payments: [
            {proof, fee: '0.00000002', paid: '0.00100000', path: viaBob(11)},
          ],
          remaining: '0.00100000',
          total_fee_rate: '11',
          total_fees: '0.00000002',
          total_paid: '0.00100000',
        },
      ],
      probes: {[payment]: 8},
      requested: [termsUrl, callbackUrl, callbackUrl, callbackUrl],
    }),
  },
  {
    args: makeArgs({
      amount: '100*k',
      // Bob changes his fee while each of the first three routes is evaluated
      network: {fee_changes: [1, 2, 3], via: bob},
    }),
    description: 'Routes that keep going unused end the stream',
    error: [503, 'WaitingForRouteErr', {
      err: [503, 'FoundRoutesCouldNotCarryPayment'],
      fee_mtokens: '0',
      mtokens: '0',
    }],
    expected: makeExpected({
      is_lnd_called: true,
      logs: [
        {...start, streaming: '0.00100000'},
        {requesting_invoice: '0.00100000'},
        {payment_request: 'lnbc1m'},
        // The fee changes as each route is evaluated, so none can be used
        {evaluating: viaBob(11)},
        {evaluating_amount: '0.00100000'},
        {evaluating: viaBob(11)},
        {evaluating_amount: '0.00100000'},
        {evaluating: viaBob(11)},
        {evaluating_amount: '0.00100000'},
      ],
      probes: {[payment]: 6},
      requested: [termsUrl, callbackUrl],
    }),
  },
  {
    args: makeArgs({
      amount: '200*k',
      network: {
        // Bob changes his fee while the routes after the first are evaluated
        fee_changes: [2, 3, 4],
        max_htlc: '100000000',
        via: bob,
      },
    }),
    description: 'Unused routes after a payment end the stream with a summary',
    error: [503, 'WaitingForRouteErr', {
      err: [503, 'FoundRoutesCouldNotCarryPayment'],
      fee_mtokens: '1100',
      mtokens: '100000000',
    }],
    expected: makeExpected({
      is_lnd_called: true,
      logs: [
        {...start, streaming: '0.00200000'},
        {requesting_invoice: '0.00200000'},
        {payment_request: 'lnbc2m'},
        {evaluating: viaBob(11)},
        {evaluating_amount: '0.00100000'},
        {requesting_invoice: '0.00100000'},
        {payment_request: 'lnbc1m'},
        {amount: '0.00100000', paying: viaBob(11)},
        {proof, fee: '0.00000002', paid: '0.00100000'},
        // Then three routes in a row go unused
        {evaluating: viaBob(11)},
        {evaluating_amount: '0.00100000'},
        {evaluating: viaBob(11)},
        {evaluating_amount: '0.00100000'},
        {evaluating: viaBob(11)},
        {evaluating_amount: '0.00100000'},
        // The stream ends, after showing what was paid
        {
          payments: [
            {proof, fee: '0.00000002', paid: '0.00100000', path: viaBob(11)},
          ],
          remaining: '0.00100000',
          total_fee_rate: '11',
          total_fees: '0.00000002',
          total_paid: '0.00100000',
        },
      ],
      probes: {[payment]: 8},
      requested: [termsUrl, callbackUrl, callbackUrl],
    }),
  },
  {
    args: makeArgs({
      amount: '200*k',
      max_payment: '100*k',
      network: {
        // Bob changes his fee during the first, second and fourth routes, so
        // three routes go unused, but never three in a row
        fee_changes: [1, 2, 4],
        via: bob,
      },
    }),
    description: 'Using a route starts the count of unused routes over',
    expected: makeExpected({
      is_lnd_called: true,
      logs: [
        {...start, max_payment: '0.00100000', streaming: '0.00200000'},
        {requesting_invoice: '0.00100000'},
        {payment_request: 'lnbc1m'},
        // Two routes go unused
        {evaluating: viaBob(11)},
        {evaluating_amount: '0.00100000'},
        {evaluating: viaBob(11)},
        {evaluating_amount: '0.00100000'},
        // The third route pays the first invoice
        {evaluating: viaBob(11)},
        {evaluating_amount: '0.00100000'},
        {amount: '0.00100000', paying: viaBob(11)},
        {proof, fee: '0.00000002', paid: '0.00100000'},
        // One more route goes unused, then the next one is used to pay
        {evaluating: viaBob(11)},
        {evaluating_amount: '0.00100000'},
        {evaluating: viaBob(11)},
        {evaluating_amount: '0.00100000'},
        {requesting_invoice: '0.00100000'},
        {payment_request: 'lnbc1m'},
        {amount: '0.00100000', paying: viaBob(11)},
        {proof, fee: '0.00000002', paid: '0.00100000'},
      ],
      probes: {[payment]: 10},
      requested: [termsUrl, callbackUrl, callbackUrl],
      summary: {
        payments: [
          {proof, fee: '0.00000002', paid: '0.00100000', path: viaBob(11)},
          {proof, fee: '0.00000002', paid: '0.00100000', path: viaBob(11)},
        ],
        total_fee_rate: '11',
        total_fees: '0.00000003',
        total_paid: '0.00200000',
      },
    }),
  },
  {
    args: makeArgs({amount: '150*k', max_payment: '100*k'}),
    description: 'A remainder below a minimum payment is shown as remaining',
    expected: makeExpected({
      is_lnd_called: true,
      logs: [
        {...start, max_payment: '0.00100000', streaming: '0.00150000'},
        {requesting_invoice: '0.00100000'},
        {payment_request: 'lnbc1m'},
        {evaluating: direct},
        {evaluating_amount: '0.00100000'},
        {amount: '0.00100000', paying: direct},
        {proof, paid: '0.00100000'},
      ],
      probes: {[payment]: 2},
      requested: [termsUrl, callbackUrl],
      // The 50k left is less than a minimum payment
      summary: {
        payments: [{proof, paid: '0.00100000', path: direct}],
        remaining: '0.00050000',
        total_paid: '0.00100000',
      },
    }),
  },
  {
    args: makeArgs({amount: '100*k', network: {is_reply_lost: true}}),
    description: 'A payment that settled counts when its reply is lost',
    expected: makeExpected({
      is_lnd_called: true,
      logs: [
        {...start, streaming: '0.00100000'},
        {requesting_invoice: '0.00100000'},
        {payment_request: 'lnbc1m'},
        {evaluating: direct},
        {evaluating_amount: '0.00100000'},
        // The reply to paying is lost, LND shows that the payment settled
        {amount: '0.00100000', paying: direct},
        {failure: 'UnexpectedErrorWhenPayingViaRoute'},
        {proof, paid: '0.00100000'},
      ],
      probes: {[payment]: 2},
      requested: [termsUrl, callbackUrl],
      summary: {
        payments: [{proof, paid: '0.00100000', path: direct}],
        total_paid: '0.00100000',
      },
    }),
  },
  {
    args: makeArgs({
      amount: '200*k',
      min_payment: '50*k',
      service: {limit: '150000000'},
    }),
    description: 'A service limit below what it advertises is searched for',
    expected: makeExpected({
      is_lnd_called: true,
      logs: [
        {...start, min_payment: '0.00050000', streaming: '0.00200000'},
        // The service declines 200k so amounts below it are tried
        {requesting_invoice: '0.00200000'},
        {invoice_declined: '0.00200000', reason: 'amount too large'},
        {requesting_invoice: '0.00100000'},
        {payment_request: 'lnbc1m'},
        {requesting_invoice: '0.00150000'},
        {payment_request: 'lnbc1500u'},
        {evaluating: direct},
        {evaluating_amount: '0.00050000'},
        {evaluating_amount: '0.00150000'},
        {amount: '0.00150000', paying: direct},
        {proof, paid: '0.00150000'},
        {evaluating: direct},
        {evaluating_amount: '0.00050000'},
        {requesting_invoice: '0.00050000'},
        {payment_request: 'lnbc500u'},
        {amount: '0.00050000', paying: direct},
        {proof, paid: '0.00050000'},
      ],
      probes: {[payment]: 5},
      requested: [
        termsUrl,
        callbackUrl,
        callbackUrl,
        callbackUrl,
        callbackUrl,
      ],
      summary: {
        payments: [
          {proof, paid: '0.00150000', path: direct},
          {proof, paid: '0.00050000', path: direct},
        ],
        total_paid: '0.00200000',
      },
    }),
  },
  {
    args: makeArgs({service: {limit: '0'}}),
    description: 'A service that declines every amount ends the stream',
    error: [503, 'NoInvoiceFound', {fee_mtokens: '0', mtokens: '0'}],
    expected: makeExpected({
      is_lnd_called: true,
      logs: [
        start,
        {requesting_invoice: '0.00200000'},
        {invoice_declined: '0.00200000', reason: 'amount too large'},
        {requesting_invoice: '0.00100000'},
        {invoice_declined: '0.00100000', reason: 'amount too large'},
      ],
      requested: [termsUrl, callbackUrl, callbackUrl],
    }),
  },
  {
    args: makeArgs({service: {is_failing: true}}),
    description: 'A service that cannot be reached ends the stream',
    error: [503, 'WaitingForInvoiceErr', {
      err: [503, 'FailedToGetPaymentRequestFromService', {err: 'err'}],
      fee_mtokens: '0',
      mtokens: '0',
    }],
    expected: makeExpected({
      is_lnd_called: true,
      logs: [start, {requesting_invoice: '0.00200000'}],
      requested: [termsUrl, callbackUrl],
    }),
  },
  {
    // The only route to alice is through bob, who is avoided
    args: makeArgs({avoid: [bob], network: {peers, via: bob}, out: peers}),
    description: 'No route through over six out peers shows six of them',
    error: [503, 'NoRouteFound', {fee_mtokens: '0', mtokens: '0'}],
    expected: makeExpected({
      is_lnd_called: true,
      logs: [
        start,
        {requesting_invoice: '0.00200000'},
        {payment_request: 'lnbc2m'},
        {
          no_route_found: {
            amount: '0.00100000',
            max_fee: '0.00000100',
            out_through: [
              `peer ${peers[0]}`,
              `peer ${peers[1]}`,
              `peer ${peers[2]}`,
              `peer ${peers[3]}`,
              `peer ${peers[4]}`,
              `peer ${peers[5]}`,
              'and 1 more',
            ],
            routes_tried: 0,
          },
        },
      ],
      requested: [termsUrl, callbackUrl],
    }),
  },
  {
    args: makeArgs({
      amount: '200*k',
      fs: withTags([{
        alias: 'friends',
        icon: '🐢',
        id: bufferAsHex(Buffer.alloc(32)),
        nodes: [alice],
      }]),
      network: {max_htlc: '100000000'},
      out: ['friends'],
      out_filters: ['OUTBOUND_LIQUIDITY > 500000'],
    }),
    description: 'Out filters are checked again before every payment',
    // After the first payment the liquidity out to alice is under the filter
    error: [503, 'WaitingForRouteErr', {
      err: [400, 'NoPeerMatchesFoundToSatisfyOutboundFilter'],
      fee_mtokens: '0',
      mtokens: '100000000',
    }],
    expected: makeExpected({
      is_lnd_called: true,
      logs: [
        {...start, streaming: '0.00200000'},
        {requesting_invoice: '0.00200000'},
        {payment_request: 'lnbc2m'},
        // Alice is tagged as a friend, so routes show the tag icon
        {evaluating: tagged},
        {evaluating_amount: '0.00100000'},
        {requesting_invoice: '0.00100000'},
        {payment_request: 'lnbc1m'},
        {amount: '0.00100000', paying: tagged},
        {proof, paid: '0.00100000'},
        // The stream ends, after showing what was paid
        {
          payments: [{proof, paid: '0.00100000', path: tagged}],
          remaining: '0.00100000',
          total_paid: '0.00100000',
        },
      ],
      probes: {[payment]: 2},
      requested: [termsUrl, callbackUrl, callbackUrl],
    }),
  },
  {
    args: makeArgs({
      amount: '200*k',
      network: {max_htlc: '100000000', peers: [alice, bob], via: bob},
      out: [alice, bob],
      out_filters: ['OUTBOUND_LIQUIDITY > 500000'],
    }),
    description: 'An out peer that drains is left out and the others carry on',
    expected: makeExpected({
      is_lnd_called: true,
      logs: [
        {...start, streaming: '0.00200000'},
        {requesting_invoice: '0.00200000'},
        {payment_request: 'lnbc2m'},
        // Both out peers pass the filter, and alice is paid directly
        {evaluating: direct},
        {evaluating_amount: '0.00100000'},
        {requesting_invoice: '0.00100000'},
        {payment_request: 'lnbc1m'},
        {amount: '0.00100000', paying: direct},
        {proof, paid: '0.00100000'},
        // The channel to alice drained under the filter, so bob is used
        {evaluating: outViaBob},
        {evaluating_amount: '0.00100000'},
        {requesting_invoice: '0.00100000'},
        {payment_request: 'lnbc1m'},
        {amount: '0.00100000', paying: outViaBob},
        {proof, fee: '0.00000002', paid: '0.00100000'},
      ],
      probes: {[payment]: 4},
      requested: [termsUrl, callbackUrl, callbackUrl, callbackUrl],
      summary: {
        payments: [
          {proof, paid: '0.00100000', path: direct},
          {proof, fee: '0.00000002', paid: '0.00100000', path: outViaBob},
        ],
        total_fee_rate: '5',
        total_fees: '0.00000002',
        total_paid: '0.00200000',
      },
    }),
  },
  {
    args: makeArgs({
      amount: '200*k',
      network: {
        // Channels close once a payment goes out through them
        is_closing: true,
        max_htlc: '100000000',
        peers: [alice, bob],
        via: bob,
      },
      out: ['alice', bob],
    }),
    description: 'An out peer alias whose channel closes is left out',
    expected: makeExpected({
      is_lnd_called: true,
      logs: [
        {...start, streaming: '0.00200000'},
        {requesting_invoice: '0.00200000'},
        {payment_request: 'lnbc2m'},
        // The alias of alice was resolved to her key before streaming
        {evaluating: direct},
        {evaluating_amount: '0.00100000'},
        {requesting_invoice: '0.00100000'},
        {payment_request: 'lnbc1m'},
        {amount: '0.00100000', paying: direct},
        {proof, paid: '0.00100000'},
        // The channel to alice closed, so bob is used
        {evaluating: outViaBob},
        {evaluating_amount: '0.00100000'},
        {requesting_invoice: '0.00100000'},
        {payment_request: 'lnbc1m'},
        {amount: '0.00100000', paying: outViaBob},
        {proof, fee: '0.00000002', paid: '0.00100000'},
      ],
      probes: {[payment]: 4},
      requested: [termsUrl, callbackUrl, callbackUrl, callbackUrl],
      summary: {
        payments: [
          {proof, paid: '0.00100000', path: direct},
          {proof, fee: '0.00000002', paid: '0.00100000', path: outViaBob},
        ],
        total_fee_rate: '5',
        total_fees: '0.00000002',
        total_paid: '0.00200000',
      },
    }),
  },
  {
    args: makeArgs({
      amount: '200*k',
      fs: friends,
      network: {
        // Peers go offline once a payment goes out to them
        is_going_offline: true,
        max_htlc: '100000000',
        peers: [alice, bob],
        via: bob,
      },
      out: ['friends', bob],
    }),
    description: 'An out tag whose peers go offline is left out',
    expected: makeExpected({
      is_lnd_called: true,
      logs: [
        {...start, streaming: '0.00200000'},
        {requesting_invoice: '0.00200000'},
        {payment_request: 'lnbc2m'},
        // Alice is a friend, and she is paid directly
        {evaluating: tagged},
        {evaluating_amount: '0.00100000'},
        {requesting_invoice: '0.00100000'},
        {payment_request: 'lnbc1m'},
        {amount: '0.00100000', paying: tagged},
        {proof, paid: '0.00100000'},
        // Alice went offline so the friends are left out, and bob is used
        {evaluating: outViaBob},
        {evaluating_amount: '0.00100000'},
        {requesting_invoice: '0.00100000'},
        {payment_request: 'lnbc1m'},
        {amount: '0.00100000', paying: outViaBob},
        {proof, fee: '0.00000002', paid: '0.00100000'},
      ],
      probes: {[payment]: 4},
      requested: [termsUrl, callbackUrl, callbackUrl, callbackUrl],
      summary: {
        payments: [
          {proof, paid: '0.00100000', path: tagged},
          {proof, fee: '0.00000002', paid: '0.00100000', path: outViaBob},
        ],
        total_fee_rate: '5',
        total_fees: '0.00000002',
        total_paid: '0.00200000',
      },
    }),
  },
  {
    args: makeArgs({
      amount: '200*k',
      fs: friends,
      network: {is_going_offline: true, max_htlc: '100000000'},
      out: ['friends'],
    }),
    description: 'Out peers all going offline ends the stream after a summary',
    error: [503, 'WaitingForRouteErr', {
      err: [404, 'NoActiveChannelWithOutgoingPeer'],
      fee_mtokens: '0',
      mtokens: '100000000',
    }],
    expected: makeExpected({
      is_lnd_called: true,
      logs: [
        {...start, streaming: '0.00200000'},
        {requesting_invoice: '0.00200000'},
        {payment_request: 'lnbc2m'},
        {evaluating: tagged},
        {evaluating_amount: '0.00100000'},
        {requesting_invoice: '0.00100000'},
        {payment_request: 'lnbc1m'},
        {amount: '0.00100000', paying: tagged},
        {proof, paid: '0.00100000'},
        // Alice went offline and there is no other out peer left
        {
          payments: [{proof, paid: '0.00100000', path: tagged}],
          remaining: '0.00100000',
          total_paid: '0.00100000',
        },
      ],
      probes: {[payment]: 2},
      requested: [termsUrl, callbackUrl, callbackUrl],
    }),
  },
  {
    args: makeArgs({
      avoid: ['slow'],
      fs: withTags([{
        alias: 'slow',
        icon: '🐌',
        id: bufferAsHex(Buffer.alloc(32)),
        nodes: [bob],
      }]),
      network: {via: bob},
    }),
    description: 'Avoided tags are noted and their nodes are not used',
    error: [503, 'NoRouteFound', {fee_mtokens: '0', mtokens: '0'}],
    expected: makeExpected({
      is_lnd_called: true,
      logs: [
        {avoiding_tag: 'slow: 1 nodes'},
        start,
        {requesting_invoice: '0.00200000'},
        {payment_request: 'lnbc2m'},
        {
          no_route_found: {
            amount: '0.00100000',
            max_fee: '0.00000100',
            routes_tried: 0,
          },
        },
      ],
      requested: [termsUrl, callbackUrl],
    }),
  },
  {
    args: makeArgs({
      fs: withTags([{
        alias: 'slow',
        icon: '🐌',
        id: bufferAsHex(Buffer.alloc(32)),
        is_avoided: true,
        nodes: [bob],
      }]),
      network: {via: bob},
    }),
    description: 'Tags that are always avoided are avoided without --avoid',
    error: [503, 'NoRouteFound', {fee_mtokens: '0', mtokens: '0'}],
    expected: makeExpected({
      is_lnd_called: true,
      logs: [
        start,
        {requesting_invoice: '0.00200000'},
        {payment_request: 'lnbc2m'},
        // The only route to alice is through bob, who is always avoided
        {
          no_route_found: {
            amount: '0.00100000',
            max_fee: '0.00000100',
            routes_tried: 0,
          },
        },
      ],
      requested: [termsUrl, callbackUrl],
    }),
  },
  {
    args: makeArgs({
      amount: '100*k',
      fs: avoidedFriends,
      network: {peers: [bob, peers[0]], via: bob},
      out: ['friends'],
    }),
    description: 'Peers of an out tag are not avoided for an avoided tag',
    expected: makeExpected({
      is_lnd_called: true,
      logs: [
        {...start, streaming: '0.00100000'},
        {requesting_invoice: '0.00100000'},
        {payment_request: 'lnbc1m'},
        {evaluating: outViaTagged('🐢')},
        {evaluating_amount: '0.00100000'},
        {amount: '0.00100000', paying: outViaTagged('🐢')},
        {proof, fee: '0.00000002', paid: '0.00100000'},
      ],
      probes: {[payment]: 2},
      requested: [termsUrl, callbackUrl],
      summary: {
        payments: [{
          proof,
          fee: '0.00000002',
          paid: '0.00100000',
          path: outViaTagged('🐢'),
        }],
        total_fee_rate: '11',
        total_fees: '0.00000002',
        total_paid: '0.00100000',
      },
    }),
  },
  {
    args: makeArgs({
      amount: '100*k',
      fs: avoidedSlow,
      network: {peers: [bob, peers[0]], via: bob},
      out: [bob, peers[0]],
    }),
    description: 'Out peers are not avoided for being in an avoided tag',
    expected: makeExpected({
      is_lnd_called: true,
      logs: [
        {...start, streaming: '0.00100000'},
        {requesting_invoice: '0.00100000'},
        {payment_request: 'lnbc1m'},
        {evaluating: outViaTagged('🐌')},
        {evaluating_amount: '0.00100000'},
        {amount: '0.00100000', paying: outViaTagged('🐌')},
        {proof, fee: '0.00000002', paid: '0.00100000'},
      ],
      probes: {[payment]: 2},
      requested: [termsUrl, callbackUrl],
      summary: {
        payments: [{
          proof,
          fee: '0.00000002',
          paid: '0.00100000',
          path: outViaTagged('🐌'),
        }],
        total_fee_rate: '11',
        total_fees: '0.00000002',
        total_paid: '0.00100000',
      },
    }),
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(streamPayment(args), error, 'Got expected error');
    } else {
      // The summary is compared together with what else is noted
      args.noted.summary = await streamPayment(args);
    }

    // What is noted is compared as shown, without colors or undefined values,
    // and payment requests are cut to the human readable part with the amount
    deepEqual(asShown(args.noted), expected, 'Got expected result');

    return;
  });
});
