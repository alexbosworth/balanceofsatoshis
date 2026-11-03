const {deepEqual} = require('node:assert').strict;
const {equal} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {getNodeInfoResponse} = require('./../fixtures');
const method = require('./../../network/pay_stream_route');

const bufferAsHex = buffer => Buffer.from(buffer).toString('hex');
const colorCodes = /\\u001b\[\d+m/g;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const {parse} = JSON;
const {stringify} = JSON;

const alice = bufferAsHex(Buffer.alloc(33, 3));
const asShown = n => parse(stringify(n).replace(colorCodes, ''));
const bob = bufferAsHex(Buffer.alloc(33, 2));
const id = bufferAsHex(Buffer.alloc(32, 1));
const payment = bufferAsHex(Buffer.alloc(32, 3));
const proof = bufferAsHex(Buffer.alloc(32, 7));

// A route that pays 150k to alice through bob, who charges 1.15 tokens
const route = {
  payment,
  fee: 1,
  fee_mtokens: '1150',
  hops: [
    {
      channel: '0x0x1',
      fee: 1,
      fee_mtokens: '1150',
      forward: 150000,
      forward_mtokens: '150000000',
      public_key: bob,
      timeout: 80,
    },
    {
      channel: '0x0x2',
      fee: 0,
      fee_mtokens: '0',
      forward: 150000,
      forward_mtokens: '150000000',
      public_key: alice,
      timeout: 40,
    },
  ],
  mtokens: '150001150',
  safe_fee: 2,
  safe_tokens: 150002,
  timeout: 80,
  tokens: 150001,
  total_mtokens: '150000000',
};

// Make a LND that pays the route, or that fails or errors when paying it
const makeLnd = args => {
  return {
    default: {
      getNodeInfo: ({pub_key}, cbk) => setImmediate(() => cbk(null, {
        ...getNodeInfoResponse,
        channels: [],
        node: {
          ...getNodeInfoResponse.node,
          pub_key,
          alias: pub_key === bob ? 'bob' : 'alice',
        },
        num_channels: '0',
      })),
    },
    router: {
      sendToRouteV2: ({}, cbk) => {
        // Exit early when there is an error paying
        if (!!args.err) {
          return cbk(args.err);
        }

        // Exit early when the payment fails
        if (!!args.failure) {
          return cbk(null, {
            failure: args.failure,
            preimage: Buffer.alloc(Number()),
          });
        }

        return cbk(null, {preimage: hexAsBuffer(proof)});
      },
    },
  };
};

// Make arguments to pay through bob to alice, the lines logged are noted
const makeArgs = overrides => {
  const noted = {logs: []};

  const args = {
    id,
    noted,
    route,
    lnd: makeLnd({}),
    logger: {info: line => noted.logs.push(line)},
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

// Make the expected lines logged, by default nothing is logged
const makeExpected = overrides => {
  const expected = {logs: []};

  Object.keys(overrides).forEach(k => expected[k] = overrides[k]);

  return expected;
};

// The route as it is described when it is paid through
const viaBob = ['0x0x1 ', `bob ${bob}. Fee rate: 0.00% (7)`, '0x0x2x0'];

const tests = [
  {
    args: makeArgs({id: undefined}),
    description: 'A payment hash is required',
    error: [400, 'ExpectedPaymentHashToPayStreamRoute'],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is required',
    error: [400, 'ExpectedAuthenticatedLndToPayStreamRoute'],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({logger: undefined}),
    description: 'A logger is required',
    error: [400, 'ExpectedLoggerToPayStreamRoute'],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({route: undefined}),
    description: 'A route is required',
    error: [400, 'ExpectedRouteToPayStreamRoute'],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({}),
    description: 'A payment shows the amount and the route it is paying',
    expected: makeExpected({logs: [{amount: '0.00150000', paying: viaBob}]}),
  },
  {
    args: makeArgs({
      lnd: makeLnd({
        failure: {code: 'CHANNEL_DISABLED', failure_source_index: 1},
      }),
    }),
    description: 'A failure on the way is shown before the payment is over',
    expected: makeExpected({
      logs: [
        {amount: '0.00150000', paying: viaBob},
        {failure: 'ChannelDisabled from bob on 0x0x2 forwarding to alice'},
      ],
    }),
  },
  {
    args: makeArgs({
      lnd: makeLnd({
        failure: {
          code: 'INCORRECT_OR_UNKNOWN_PAYMENT_DETAILS',
          failure_source_index: 2,
        },
      }),
    }),
    description: 'A payment rejected by the destination is shown as rejected',
    expected: makeExpected({
      logs: [
        {amount: '0.00150000', paying: viaBob},
        {failure: 'UnknownPaymentHash from alice'},
      ],
    }),
  },
  {
    args: makeArgs({lnd: makeLnd({err: {details: 'ConnectionDropped'}})}),
    description: 'An error paying the route is passed back',
    error: [503, 'UnexpectedErrorWhenPayingViaRoute', {
      err: {details: 'ConnectionDropped'},
    }],
    expected: makeExpected({
      logs: [
        {amount: '0.00150000', paying: viaBob},
        {failure: 'UnexpectedErrorWhenPayingViaRoute'},
      ],
    }),
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(method(args), error, 'Got expected error');
    } else {
      equal(await method(args), undefined, 'Paying calls back with no result');
    }

    // Lines are compared as shown, without colors or undefined values
    deepEqual(asShown(args.noted), expected, 'Got expected lines');

    return;
  });
});
