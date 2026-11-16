const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {getFeesPaid} = require('./../../routing');
const {getInfoResponse} = require('./../fixtures');

const at = '1704283200';
const atNs = String(BigInt(at) * BigInt(1e9));
const bufferAsHex = buffer => buffer.toString('hex');

// File system methods for chain prices, which known prices do not need
const fs = {
  getFile: (path, cbk) => cbk('err'),
  makeDirectory: (path, cbk) => cbk('err'),
  renameFile: (from, to, cbk) => cbk('err'),
  writeFile: (path, contents, cbk) => cbk('err'),
};

// A route hop forwarding 2 BTC to a peer
const makeHop = ({fee, key}) => ({
  amt_to_forward: '200000000',
  amt_to_forward_msat: '200000000000',
  chan_capacity: '0',
  chan_id: '1',
  custom_records: {},
  expiry: 40,
  fee: String(fee),
  fee_msat: String(fee * 1e3),
  mpp_record: null,
  pub_key: key,
  tlv_payload: true,
});

// A node that paid a 1 BTC routing fee on a day with a known price
const makeLnd = () => ({
  default: {
    getInfo: ({}, cbk) => cbk(null, getInfoResponse),
    listChannels: ({}, cbk) => cbk(null, {channels: []}),
    listPayments: ({index_offset}, cbk) => cbk(null, {
      first_index_offset: '1',
      last_index_offset: '1',
      // The payment is on the first page, the next page is empty
      payments: !!index_offset ? [] : [{
        creation_date: at,
        creation_time_ns: atNs,
        failure_reason: 'FAILURE_REASON_NONE',
        fee: '100000000',
        fee_msat: '100000000000',
        fee_sat: '100000000',
        htlcs: [{
          attempt_id: '1',
          attempt_time_ns: atNs,
          failure: null,
          preimage: Buffer.alloc(32, 1),
          resolve_time_ns: atNs,
          route: {
            hops: [
              makeHop({
                fee: 100000000,
                key: bufferAsHex(Buffer.alloc(33, 3)),
              }),
              makeHop({fee: 0, key: bufferAsHex(Buffer.alloc(33, 4))}),
            ],
            total_amt: '300000000',
            total_amt_msat: '300000000000',
            total_fees: '100000000',
            total_fees_msat: '100000000000',
            total_time_lock: 40,
          },
          status: 'SUCCEEDED',
        }],
        payment_hash: bufferAsHex(Buffer.alloc(32)),
        payment_index: '1',
        payment_preimage: bufferAsHex(Buffer.alloc(32, 1)),
        payment_request: '',
        status: 'SUCCEEDED',
        value: '200000000',
        value_msat: '200000000000',
        value_sat: '200000000',
      }],
      total_num_payments: '1',
    }),
  },
});

const makeArgs = overrides => {
  const args = {
    fs,
    end_date: '2024-01-07',
    lnds: [makeLnd()],
    start_date: '2024-01-01',
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const makeExpected = overrides => {
  const expected = {
    data: [0, 0, 100000000, 0, 0, 0, 0],
    description: 'Fees paid in 7 days from 01/01/2024 to 01/07/2024. Total: 1.00000000',
    rows: undefined,
    title: 'Routing fees paid',
  };

  Object.keys(overrides).forEach(k => expected[k] = overrides[k]);

  return expected;
};

const tests = [
  {
    args: makeArgs({fs: undefined}),
    description: 'File system methods are required',
    error: [400, 'ExpectedFsMethodsToGetRoutingFeesPaid'],
  },
  {
    args: makeArgs({is_fiat: true, is_most_fees_table: true}),
    description: 'The most fees table cannot be valued in fiat',
    error: [400, 'ExpectedChartNotFeesTableForFiatFeesPaid'],
  },
  {
    args: makeArgs({is_fiat: true, is_most_forwarded_table: true}),
    description: 'The most forwarded table cannot be valued in fiat',
    error: [400, 'ExpectedChartNotForwardedTableForFiatFeesPaid'],
  },
  {
    args: makeArgs({}),
    description: 'Fees paid chart data is returned in tokens',
    expected: makeExpected({}),
  },
  {
    args: makeArgs({is_fiat: true}),
    description: 'Fees paid chart data is returned in fiat',
    expected: makeExpected({
      data: [0, 0, 42775.74, 0, 0, 0, 0],
      description: 'Fees paid in 7 days from 01/01/2024 to 01/07/2024. Total: 42775.74 USD',
      title: 'Routing fees paid (USD)',
    }),
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(getFeesPaid(args), error, 'Got expected error');
    } else {
      deepEqual(await getFeesPaid(args), expected, 'Got expected fees paid');
    }

    return;
  });
});
