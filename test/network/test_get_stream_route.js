const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {getInfoResponse} = require('./../fixtures');
const {getNodeInfoResponse} = require('./../fixtures');
const {listChannelsResponse} = require('./../fixtures');
const method = require('./../../network/get_stream_route');

const bufferAsHex = buffer => Buffer.from(buffer).toString('hex');
const colorCodes = /\\u001b\[\d+m/g;
const noRoute = {details: 'unable to find a path to destination'};
const {parse} = JSON;
const {stringify} = JSON;

const alice = bufferAsHex(Buffer.alloc(33, 3));
const asShown = n => parse(stringify(n).replace(colorCodes, ''));
const payment = bufferAsHex(Buffer.alloc(32, 3));

// Make a LND with a channel to alice that finds a route to her, or no route
const makeLnd = args => {
  return {
    default: {
      deletePayment: ({}, cbk) => cbk(),
      getInfo: ({}, cbk) => cbk(null, getInfoResponse),
      getNodeInfo: ({pub_key}, cbk) => setImmediate(() => cbk(null, {
        ...getNodeInfoResponse,
        channels: [],
        node: {...getNodeInfoResponse.node, pub_key, alias: 'alice'},
        num_channels: '0',
      })),
      listChannels: ({}, cbk) => cbk(null, {
        channels: [{
          ...listChannelsResponse.channels[0],
          chan_id: '1',
          remote_pubkey: alice,
        }],
      }),
      queryRoutes: ({amt_msat}, cbk) => {
        // Exit early when there is no route to alice
        if (!!args.is_unroutable) {
          return cbk(noRoute);
        }

        return cbk(null, {
          routes: [{
            hops: [{
              amt_to_forward_msat: amt_msat,
              chan_id: '1',
              custom_records: {},
              expiry: 40,
              fee_msat: '0',
              pub_key: alice,
              tlv_payload: true,
            }],
            total_amt: '100000',
            total_amt_msat: amt_msat,
            total_fees: '0',
            total_fees_msat: '0',
            total_time_lock: 40,
          }],
        });
      },
    },
    router: {
      // The probe reaches alice who does not know the payment hash
      sendToRouteV2: ({}, cbk) => cbk(null, {
        failure: {
          code: 'INCORRECT_OR_UNKNOWN_PAYMENT_DETAILS',
          failure_source_index: 1,
        },
        preimage: Buffer.alloc(Number()),
      }),
    },
  };
};

// Make arguments to find a route to alice for 100k with a max fee of 100, the
// lines that are logged are noted
const makeArgs = overrides => {
  const noted = {logs: []};

  const args = {
    noted,
    payment,
    cltv_delta: 43,
    destination: alice,
    fs: {getFile: (path, cbk) => cbk('err')},
    ignore: [],
    lnd: makeLnd({}),
    logger: {info: line => noted.logs.push(line)},
    max_fee_mtokens: '100000',
    mtokens: '100000000',
    out: [],
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

// Make the expected result and lines logged, by default nothing is logged
const makeExpected = overrides => {
  const expected = {logs: []};

  Object.keys(overrides).forEach(k => expected[k] = overrides[k]);

  return expected;
};

const tests = [
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is required',
    error: [400, 'ExpectedAuthenticatedLndToGetStreamRoute'],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({logger: undefined}),
    description: 'A logger is required',
    error: [400, 'ExpectedLoggerToGetStreamRoute'],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({mtokens: undefined}),
    description: 'An amount to probe with is required',
    error: [400, 'ExpectedMillitokensToGetStreamRoute'],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({filters: ['OUTBOUND_LIQUIDITY > 1'], out: [alice]}),
    description: 'An out peer has to pass the out filters to find a route',
    error: [400, 'NoPeerMatchesFoundToSatisfyOutboundFilter'],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({out: [alice]}),
    description: 'A route is found by probing out through an out peer',
    expected: makeExpected({
      logs: [
        {evaluating: ['0x0x1 ', `alice ${alice}. Fee rate: 0.00% (0)`]},
      ],
      route: {
        payment,
        fee: 0,
        fee_mtokens: '0',
        hops: [{
          channel: '0x0x1',
          fee: 0,
          fee_mtokens: '0',
          forward: 100000,
          forward_mtokens: '100000000',
          public_key: alice,
          timeout: 40,
        }],
        messages: [],
        mtokens: '100000000',
        safe_fee: 0,
        safe_tokens: 100000,
        timeout: 40,
        tokens: 100000,
        total_mtokens: '100000000',
      },
    }),
  },
  {
    args: makeArgs({lnd: makeLnd({is_unroutable: true})}),
    description: 'No route is noted with the amount and max fee searched for',
    expected: makeExpected({
      logs: [
        {
          no_route_found: {
            amount: '0.00100000',
            max_fee: '0.00000100',
            routes_tried: 0,
          },
        },
      ],
    }),
  },
  {
    args: makeArgs({lnd: makeLnd({is_unroutable: true}), out: [alice]}),
    description: 'No route is noted with the out peers searched through',
    expected: makeExpected({
      logs: [
        {
          no_route_found: {
            amount: '0.00100000',
            max_fee: '0.00000100',
            out_through: [`alice ${alice}`],
            routes_tried: 0,
          },
        },
      ],
    }),
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(method(args), error, 'Got expected error');
    } else {
      // The result is compared together with the lines that were logged
      Object.assign(args.noted, await method(args));
    }

    // What is noted is compared as shown, without colors or undefined values
    deepEqual(asShown(args.noted), expected, 'Got expected result');

    return;
  });
});
