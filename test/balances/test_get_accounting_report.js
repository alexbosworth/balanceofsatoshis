const {test} = require('@alexbosworth/tap');

const {getAccountingReport} = require('./../../balances');
const {getInfoResponse} = require('./../fixtures');

const makeLnd = ({unconfirmedBalance}) => {
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
          timestamp: '1',
          timestamp_ns: '1000000000',
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
    request: ({}, cbk) => cbk(
      null,
      {statusCode: 200},
      {market_data: {current_price: {usd: 12.34}}},
    ),
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

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
    args: makeArgs({year: Infinity}),
    description: 'Date must be reasonable',
    error: [400, 'UnrecognizedFormatForAccountingYear'],
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
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, rejects, strictSame}) => {
    if (!!error) {
      await rejects(getAccountingReport(args), error, 'Got expected error');
    } else {
      const res = await getAccountingReport(args);

      if (!args.is_csv) {
        res.rows_summary[1][2] = '';
      }

      strictSame(res, expected, 'Got expected response');
    }

    return end();
  });
});
