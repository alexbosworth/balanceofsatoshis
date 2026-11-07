const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {getAccountingReport} = require('./../../balances');
const {getInfoResponse} = require('./../fixtures');

const bufferAsHex = buffer => buffer.toString('hex');
const now = '2025-01-01T00:00:00.000Z';

// Coinbase Exchange has an hourly candle at the start of the day
const candles = [[0, 12.34, 12.34, 12.34, 12.34, 1]];

// The categories that can be reported
const categories = [
  'chain-fees',
  'chain-receives',
  'chain-sends',
  'forwards',
  'invoices',
  'lightning-fees',
  'payments',
];

// CoinGecko has its own price for the day
const coingecko = {market_data: {current_price: {usd: 43.21}}};

// A node on testnet
const testnetInfo = Object.assign({}, getInfoResponse, {
  chains: [{chain: 'bitcoin', network: 'testnet'}],
});

const makeLnd = ({at, info}) => {
  // The forward is a second into 1970 unless another time is given
  const seconds = at || 1;

  return {
    default: {
      forwardingHistory: ({}, cbk) => cbk(null, {
        forwarding_events: [{
          amt_in: '1',
          amt_in_msat: '1000',
          amt_out: '2',
          amt_out_msat: '2000',
          chan_id_in: '1',
          chan_id_out: '2',
          fee: '1',
          fee_msat: '1000',
          timestamp: String(seconds),
          timestamp_ns: String(BigInt(seconds) * BigInt(1e9)),
        }],
        last_offset_index: '1',
      }),
      getInfo: ({}, cbk) => cbk(null, info || getInfoResponse),
    },
  };
};

// A route hop forwarding 2 tokens to a peer
const makeHop = ({fee, key}) => ({
  amt_to_forward: '2',
  amt_to_forward_msat: '2000',
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

// LND that paid a 1 token routing fee on a payment. It has no chain methods
// because a lightning fees report does not look anything up on chain
const makePaymentsLnd = () => {
  const at = '1';
  const atNs = String(BigInt(at) * BigInt(1e9));

  return {
    default: {
      getInfo: ({}, cbk) => cbk(null, getInfoResponse),
      listPayments: ({}, cbk) => cbk(null, {
        first_index_offset: '1',
        last_index_offset: '1',
        payments: [{
          creation_date: at,
          creation_time_ns: atNs,
          failure_reason: 'FAILURE_REASON_NONE',
          fee: '1',
          fee_msat: '1000',
          fee_sat: '1',
          htlcs: [{
            attempt_id: '1',
            attempt_time_ns: atNs,
            failure: null,
            preimage: Buffer.alloc(32, 1),
            resolve_time_ns: atNs,
            route: {
              hops: [
                makeHop({fee: 1, key: bufferAsHex(Buffer.alloc(33, 3))}),
                makeHop({fee: 0, key: bufferAsHex(Buffer.alloc(33, 4))}),
              ],
              total_amt: '3',
              total_amt_msat: '3000',
              total_fees: '1',
              total_fees_msat: '1000',
              total_time_lock: 40,
            },
            status: 'SUCCEEDED',
          }],
          payment_hash: bufferAsHex(Buffer.alloc(32)),
          payment_index: '1',
          payment_preimage: bufferAsHex(Buffer.alloc(32, 1)),
          payment_request: '',
          status: 'SUCCEEDED',
          value: '2',
          value_msat: '2000',
          value_sat: '2',
        }],
        total_num_payments: '1',
      }),
    },
  };
};

const makeArgs = overrides => {
  const args = {
    category: 'forwards',
    lnds: [makeLnd({})],
    request: ({url}, cbk) => {
      // Coinbase Exchange is asked for the hourly candles of a day
      if (url.includes('/candles?')) {
        return cbk(null, {statusCode: 200}, candles);
      }

      return cbk(null, {statusCode: 200}, coingecko);
    },
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

// File system methods for chain prices that should not be needed
const makeFs = () => ({
  getFile: (path, cbk) => cbk('err'),
  makeDirectory: (path, cbk) => cbk('err'),
  renameFile: (from, to, cbk) => cbk('err'),
  writeFile: (path, contents, cbk) => cbk('err'),
});

const tests = [
  {
    args: makeArgs({category: undefined}),
    description: 'A category is required',
    error: [400, 'ExpectedKnownAccountingRecordsCategory', {categories}],
  },
  {
    args: makeArgs({category: 'category'}),
    description: 'A known category is required',
    error: [400, 'ExpectedKnownAccountingRecordsCategory', {categories}],
  },
  {
    args: makeArgs({date: '1'}),
    description: 'A month is required when specifying a date',
    error: [400, 'ExpectedMonthForDateToGetAccountingReport'],
  },
  {
    args: makeArgs({date: '30', month: '2'}),
    description: 'A date has to be a day in the month',
    error: [400, 'ExpectedDayInMonthForAccountingDate'],
  },
  {
    args: makeArgs({lnds: undefined}),
    description: 'LNDs are required',
    error: [400, 'ExpectedAuthenticatedLndsToGetAccountingReport'],
  },
  {
    args: makeArgs({lnds: []}),
    description: 'An LND is required',
    error: [400, 'ExpectedAuthenticatedLndsToGetAccountingReport'],
  },
  {
    args: makeArgs({lnds: [makeLnd({}), makeLnd({info: testnetInfo})]}),
    description: 'Nodes have to be on the same network',
    error: [400, 'ExpectedSameNetworkNodesForAccountingReport'],
  },
  {
    args: makeArgs({request: undefined}),
    description: 'Request function is required',
    error: [400, 'ExpectedRequestFunctionToGetAccountingReport'],
  },
  {
    args: makeArgs({year: Symbol()}),
    description: 'A valid date range is required',
    error: [400, 'Cannot convert a Symbol value to a number'],
  },
  {
    args: makeArgs({fs: {getFile: () => {}}}),
    description: 'Complete file system methods are required',
    error: [400, 'ExpectedFileSystemMethodsToGetAccountingReport'],
  },
  {
    args: makeArgs({
      fs: {getFile: 1, makeDirectory: 1, renameFile: 1, writeFile: 1},
    }),
    description: 'File system methods are functions',
    error: [400, 'ExpectedFileSystemMethodsToGetAccountingReport'],
  },
  {
    args: makeArgs({}),
    description: 'Get accounting report',
    expected: {
      rows: [
        [
          'Amount',
          'Asset',
          'Date & Time',
          'Fiat Amount',
          'From ID',
          'Network ID',
          'Notes',
          'To ID',
          'Transaction ID',
          'Type',
        ],
        [
          '1',
          'BTC',
          '1970-01-01T00:00:01.000Z',
          '0.00',
          '0x0x1',
          '',
          '2',
          '0x0x2',
          '',
          'income',
        ],
      ],
      rows_summary: [
        ['Total', 'Asset', 'Report Date', 'Total Fiat'],
        [1, 'BTC', now, '0.00'],
      ],
    },
  },
  {
    args: makeArgs({is_csv: true}),
    description: 'Get accounting report CSV',
    expected: `"Amount","Asset","Date & Time","Fiat Amount","From ID","Network ID","Notes","To ID","Transaction ID","Type"\n1,"BTC","1970-01-01T00:00:01.000Z",1.234e-7,"0x0x1","","2","0x0x2","","income"`,
  },
  {
    args: makeArgs({
      currency: 'BTC',
      fiat: 'USD',
      is_csv: true,
      rate_provider: 'coingecko',
    }),
    description: 'Get accounting report CSV with specified options',
    expected: `"Amount","Asset","Date & Time","Fiat Amount","From ID","Network ID","Notes","To ID","Transaction ID","Type"\n1,"BTC","1970-01-01T00:00:01.000Z",4.321e-7,"0x0x1","","2","0x0x2","","income"`,
  },
  {
    args: makeArgs({is_csv: true, rate_provider: 'coinbase'}),
    description: 'Get accounting report CSV with hourly Coinbase prices',
    expected: `"Amount","Asset","Date & Time","Fiat Amount","From ID","Network ID","Notes","To ID","Transaction ID","Type"\n1,"BTC","1970-01-01T00:00:01.000Z",1.234e-7,"0x0x1","","2","0x0x2","","income"`,
  },
  {
    args: makeArgs({fs: makeFs(), is_csv: true}),
    description: 'A record chain prices cannot value is valued on Coinbase',
    expected: `"Amount","Asset","Date & Time","Fiat Amount","From ID","Network ID","Notes","To ID","Transaction ID","Type"\n1,"BTC","1970-01-01T00:00:01.000Z",1.234e-7,"0x0x1","","2","0x0x2","","income"`,
  },
  {
    args: makeArgs({
      fs: makeFs(),
      is_csv: true,
      lnds: [makeLnd({at: Date.parse('2024-01-01T12:00:00.000Z') / 1000})],
    }),
    description: 'A record on a day with a chain price is valued with it',
    expected: `"Amount","Asset","Date & Time","Fiat Amount","From ID","Network ID","Notes","To ID","Transaction ID","Type"\n1,"BTC","2024-01-01T12:00:00.000Z",0.0004266048,"0x0x1","","2","0x0x2","","income"`,
  },
  {
    args: makeArgs({is_fiat_disabled: true}),
    description: 'Get accounting report without fiat conversion',
    expected: {
      rows: [
        [
          'Amount',
          'Asset',
          'Date & Time',
          'Fiat Amount',
          'From ID',
          'Network ID',
          'Notes',
          'To ID',
          'Transaction ID',
          'Type',
        ],
        [
          '1',
          'BTC',
          '1970-01-01T00:00:01.000Z',
          '',
          '0x0x1',
          '',
          '2',
          '0x0x2',
          '',
          'income',
        ],
      ],
      rows_summary: [
        ['Total', 'Asset', 'Report Date', 'Total Fiat'],
        [1, 'BTC', now, ''],
      ],
    },
  },
  {
    args: makeArgs({
      category: 'lightning-fees',
      is_fiat_disabled: true,
      lnds: [makePaymentsLnd()],
    }),
    description: 'Lightning fees are only the routing fees paid on payments',
    expected: {
      rows: [
        [
          'Amount',
          'Asset',
          'Date & Time',
          'Fiat Amount',
          'From ID',
          'Network ID',
          'Notes',
          'To ID',
          'Transaction ID',
          'Type',
        ],
        [
          '-1',
          'BTC',
          '1970-01-01T00:00:01.000Z',
          '',
          '',
          '',
          'Routing fee',
          '',
          '00000000000000000000000000000000',
          'fee:network',
        ],
      ],
      rows_summary: [
        ['Total', 'Asset', 'Report Date', 'Total Fiat'],
        [-1, 'BTC', now, ''],
      ],
    },
  },
  {
    args: makeArgs({
      is_fiat_disabled: true,
      lnds: [makeLnd({at: 3}), makeLnd({at: 2})],
    }),
    description: 'Records of several nodes are merged in order of date',
    expected: {
      rows: [
        [
          'Amount',
          'Asset',
          'Date & Time',
          'Fiat Amount',
          'From ID',
          'Network ID',
          'Notes',
          'To ID',
          'Transaction ID',
          'Type',
        ],
        [
          '1',
          'BTC',
          '1970-01-01T00:00:02.000Z',
          '',
          '0x0x1',
          '',
          '2',
          '0x0x2',
          '',
          'income',
        ],
        [
          '1',
          'BTC',
          '1970-01-01T00:00:03.000Z',
          '',
          '0x0x1',
          '',
          '2',
          '0x0x2',
          '',
          'income',
        ],
      ],
      rows_summary: [
        ['Total', 'Asset', 'Report Date', 'Total Fiat'],
        [2, 'BTC', now, ''],
      ],
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({mock}) => {
    mock.timers.enable({apis: ['Date'], now: Date.parse(now)});

    if (!!error) {
      await rejects(getAccountingReport(args), error, 'Got expected error');
    } else {
      deepEqual(await getAccountingReport(args), expected, 'Got report');
    }

    return;
  });
});
