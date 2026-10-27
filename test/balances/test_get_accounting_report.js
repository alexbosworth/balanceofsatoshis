const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {getAccountingReport} = require('./../../balances');
const {getInfoResponse} = require('./../fixtures');

// Coinbase Exchange has an hourly candle at the start of the day
const candles = [[0, 12.34, 12.34, 12.34, 12.34, 1]];

// CoinGecko has its own price for the day
const coingecko = {market_data: {current_price: {usd: 43.21}}};

const makeLnd = ({at}) => {
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
      getInfo: ({}, cbk) => cbk(null, getInfoResponse),
    },
  };
};

const makeArgs = overrides => {
  const args = {
    category: 'forwards',
    lnd: makeLnd({}),
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
    error: [400, 'ExpectedKnownAccountingRecordsCategory'],
  },
  {
    args: makeArgs({category: 'category'}),
    description: 'A known category is required',
    error: [400, 'ExpectedKnownAccountingRecordsCategory'],
  },
  {
    args: makeArgs({date: '1'}),
    description: 'A month is required when specifying a date',
    error: [400, 'ExpectedMonthForDateToGetAccountingReport'],
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is required',
    error: [400, 'ExpectedAuthenticatedLndToGetAccountingReport'],
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
        [1, 'BTC', '', '0.00'],
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
      lnd: makeLnd({at: Date.parse('2024-01-01T12:00:00.000Z') / 1000}),
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
        [1, 'BTC', '', ''],
      ],
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(getAccountingReport(args), error, 'Got expected error');
    } else {
      const res = await getAccountingReport(args);

      if (!args.is_csv) {
        res.rows_summary[1][2] = '';
      }

      deepEqual(res, expected, 'Got expected response');
    }

    return;
  });
});
