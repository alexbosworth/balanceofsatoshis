const {deepEqual} = require('node:assert').strict;
const test = require('node:test');

const {executeProbe} = require('./../../network');
const {getInfoResponse} = require('./../fixtures');
const {getNodeInfoResponse} = require('./../fixtures');

const bufferAsHex = buffer => Buffer.from(buffer).toString('hex');
const noRoute = {details: 'unable to find a path to destination'};

const destination = bufferAsHex(Buffer.alloc(33, 3));
const peer = bufferAsHex(Buffer.alloc(33, 2));

// A route out through a peer to the destination
const route = {
  hops: [
    {
      amt_to_forward_msat: '100000000',
      chan_id: '1',
      custom_records: {},
      expiry: 80,
      fee_msat: '1000',
      pub_key: peer,
      tlv_payload: true,
    },
    {
      amt_to_forward_msat: '100000000',
      chan_id: '2',
      custom_records: {},
      expiry: 40,
      fee_msat: '0',
      pub_key: destination,
      tlv_payload: true,
    },
  ],
  total_amt: '100001',
  total_amt_msat: '100001000',
  total_fees: '1',
  total_fees_msat: '1000',
  total_time_lock: 80,
};

// Make a LND that finds one route which fails, and is slow to describe nodes
const makeLnd = ({}) => {
  const waiting = [];
  let queries = Number();

  return {
    default: {
      deletePayment: ({}, cbk) => cbk(),
      getInfo: ({}, cbk) => cbk(null, getInfoResponse),
      getNodeInfo: ({pub_key}, cbk) => {
        // Node details only arrive after the route search is over
        return waiting.push(() => cbk(null, {
          ...getNodeInfoResponse,
          channels: [],
          node: {...getNodeInfoResponse.node, alias: 'alias', pub_key},
          num_channels: '0',
        }));
      },
      queryRoutes: ({}, cbk) => {
        // Exit early with the route on the first search
        if (!queries++) {
          return cbk(null, {routes: [route], success_prob: 1});
        }

        setImmediate(() => waiting.forEach(respond => respond()));

        return cbk(noRoute);
      },
    },
    router: {
      sendToRouteV2: ({}, cbk) => cbk(null, {
        failure: {
          chan_id: '2',
          code: 'TEMPORARY_CHANNEL_FAILURE',
          failure_source_index: 1,
        },
        preimage: Buffer.alloc(Number()),
      }),
    },
  };
};

// Make arguments to probe to the destination, the kinds of lines are noted
const makeArgs = overrides => {
  const noted = {logs: []};

  const args = {
    destination,
    noted,
    cltv_delta: 40,
    lnd: makeLnd({}),
    logger: {
      error: () => {},
      info: line => noted.logs.push(Object.keys(line)[0]),
    },
    mtokens: '100000000',
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

// Make the expected result, one route is tried and its failure is logged
const makeExpected = overrides => {
  const expected = {attempted_paths: 1, logs: ['evaluating', 'failure']};

  Object.keys(overrides).forEach(k => expected[k] = overrides[k]);

  return expected;
};

const tests = [
  {
    args: makeArgs({}),
    description: 'Failures are logged before a probe returns with no route',
    expected: makeExpected({}),
  },
];

tests.forEach(({args, description, expected}) => {
  return test(description, async () => {
    // The result is compared together with the kinds of lines that were logged
    Object.assign(args.noted, await executeProbe(args));

    deepEqual(args.noted, expected, 'Got expected result');

    return;
  });
});
