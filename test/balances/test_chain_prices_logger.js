const {deepEqual} = require('node:assert').strict;
const test = require('node:test');

const method = require('./../../balances/chain_prices_logger');

const now = '2025-03-01T12:00:00.000Z';

// A price estimated from a full day of blocks, as it is logged
const dayPrice = overrides => ({
  chain_price: Object.assign({
    agreement: 0.905,
    blocks: 140,
    confidence: 1.157,
    date: '2025-02-27',
    dispersion: 0.015,
    outputs: 288193,
    payments: 31594,
    price: '77135.75',
    rivalry: 0.359,
    stability: 0,
  },
  overrides),
});

// The description of a price estimated from a full day of blocks
const described = overrides => ({
  chain_price: Object.assign({
    blocks: 140,
    date: '2025-02-27',
    note: undefined,
    payment_outputs: 288193,
    price: '77135.75',
    price_range: '76564 to 77712',
    round_dollar_payments: 31594,
  },
  overrides),
});

// Log through a chain prices logger, collecting what it logs
const logThrough = args => {
  const logged = {errors: [], lines: []};

  const {logger} = method({
    logger: !!args.is_without_logger ? undefined : {
      error: err => logged.errors.push(err),
      info: line => logged.lines.push(line),
    },
  });

  // Exit early when there is no logger to log through
  if (!logger) {
    return {};
  }

  args.errors.forEach(err => logger.error(err));
  args.lines.forEach(line => logger.info(line));

  return logged;
};

const makeArgs = overrides => {
  const args = {errors: [], lines: []};

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const makeExpected = overrides => {
  const expected = {errors: [], lines: []};

  Object.keys(overrides).forEach(k => expected[k] = overrides[k]);

  return expected;
};

const tests = [
  {
    args: makeArgs({
      lines: [{fetching_blocks: {blocks: '24/144', date: '2025-01-01'}}],
    }),
    description: 'Fetching blocks is logged as calculating prices from blocks',
    expected: makeExpected({
      lines: [{
        calculating_prices_from_blocks: {
          blocks: '24/144',
          day: '2025-01-01',
          days_out_of_date: 59,
        },
      }],
    }),
  },
  {
    args: makeArgs({
      lines: [{fetching_blocks: {blocks: '72/72', date: '2025-03-01'}}],
    }),
    description: 'Blocks of today have no days out of date',
    expected: makeExpected({
      lines: [{
        calculating_prices_from_blocks: {
          blocks: '72/72',
          day: '2025-03-01',
          days_out_of_date: undefined,
        },
      }],
    }),
  },
  {
    args: makeArgs({
      lines: [{fetching_blocks: {blocks: '144/144', date: '2025-02-28'}}],
    }),
    description: 'Blocks of yesterday are a day out of date',
    expected: makeExpected({
      lines: [{
        calculating_prices_from_blocks: {
          blocks: '144/144',
          day: '2025-02-28',
          days_out_of_date: 1,
        },
      }],
    }),
  },
  {
    args: makeArgs({lines: [{fetching_blocks: {blocks: '24/144'}}]}),
    description: 'Fetching blocks without a day has no days out of date',
    expected: makeExpected({
      lines: [{
        calculating_prices_from_blocks: {
          blocks: '24/144',
          day: undefined,
          days_out_of_date: undefined,
        },
      }],
    }),
  },
  {
    args: makeArgs({lines: [dayPrice({})]}),
    description: 'A day price is described by its range, blocks and payments',
    expected: makeExpected({lines: [described({})]}),
  },
  {
    args: makeArgs({lines: [dayPrice({dispersion: 0})]}),
    description: 'Payments that all point to one price have a narrow range',
    expected: makeExpected({
      lines: [described({price_range: '77136 to 77136'})],
    }),
  },
  {
    args: makeArgs({lines: [dayPrice({dispersion: undefined})]}),
    description: 'A day price without a dispersion has no range',
    expected: makeExpected({lines: [described({price_range: undefined})]}),
  },
  {
    args: makeArgs({
      lines: [dayPrice({is_unsettled: true, is_widened: true})],
    }),
    description: 'Flags on a day price are described as notes',
    expected: makeExpected({
      lines: [
        described({
          note: [
            'the estimate was still shifting when refining stopped',
            'found outside the expected price range',
          ].join(', '),
        }),
      ],
    }),
  },
  {
    args: makeArgs({
      lines: [{
        chain_price: {date: '2025-03-01', is_provisional: true, price: '1.00'},
      }],
    }),
    description: 'A provisional price is noted as provisional',
    expected: makeExpected({
      lines: [{
        chain_price: {
          blocks: undefined,
          date: '2025-03-01',
          note: 'provisional, the day is not over yet',
          payment_outputs: undefined,
          price: '1.00',
          price_range: undefined,
          round_dollar_payments: undefined,
        },
      }],
    }),
  },
  {
    args: makeArgs({lines: [{chain_price: {starting_from: '2025-02-28'}}]}),
    description: 'A chain price line without a price is logged as it is',
    expected: makeExpected({
      lines: [{chain_price: {starting_from: '2025-02-28'}}],
    }),
  },
  {
    args: makeArgs({lines: [{unsupported_starting_day: '2025-02-28'}]}),
    description: 'Other lines are logged as they are',
    expected: makeExpected({
      lines: [{unsupported_starting_day: '2025-02-28'}],
    }),
  },
  {
    args: makeArgs({errors: ['err']}),
    description: 'Errors are logged as errors',
    expected: makeExpected({errors: ['err']}),
  },
  {
    args: makeArgs({is_without_logger: true}),
    description: 'Without a logger there is no logger',
    expected: {},
  },
];

tests.forEach(({args, description, expected}) => {
  return test(description, ({mock}, end) => {
    mock.timers.enable({apis: ['Date'], now: Date.parse(now)});

    deepEqual(logThrough(args), expected, 'Got expected logs');

    return end();
  });
});
