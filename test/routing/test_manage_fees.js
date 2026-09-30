const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const manageFees = require('./../../routing/manage_fees');

// Logged times are local times, so use a fixed time zone to make them known
process.env.TZ = 'UTC';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const feesTable = '┌──────┬─────────┬──────────────────┬────────────┐\n│ Peer │ Out Fee │ Inbound Discount │ Public Key │\n└──────┴─────────┴──────────────────┴────────────┘\n';
const header = ['Peer', 'Out Fee', 'Inbound Discount', 'Public Key'];
const lndError = {err: [503, 'UnexpectedGetChannelsError', {err: 'err'}]};
const now = Date.UTC(2020, 0, 1, 12);
const repeatLog = {
  repeat_interval: '2 ms',
  repeating_fees_at: 'Today at 12:00 PM',
};
const repeatsWaitMs = 100;

// LND that has no channels and answers each attempt with a scripted outcome
const makeLnd = ({outcomes}) => {
  const attempts = [];

  // Attempts past the scripted outcomes are never answered, ending repeats
  const respond = (cbk, res) => {
    const isSuccess = outcomes[attempts.length - 1];

    if (isSuccess === undefined) {
      return;
    }

    return !isSuccess ? cbk('err') : cbk(null, res);
  };

  const pending = {
    pending_force_closing_channels: [],
    pending_open_channels: [],
    waiting_close_channels: [],
  };

  const publicKey = {key_loc: {key_index: 0}, raw_key_bytes: Buffer.alloc(33)};

  return {
    default: {
      feeReport: ({}, cbk) => respond(cbk, {channel_fees: []}),
      listChannels: ({}, cbk) => {
        // Every attempt starts by listing the channels
        attempts.push(cbk);

        return respond(cbk, {channels: []});
      },
      pendingChannels: ({}, cbk) => respond(cbk, pending),
    },
    wallet: {deriveKey: ({}, cbk) => respond(cbk, publicKey)},
  };
};

// A logger that keeps a record of everything logged, in order
const makeLogger = () => {
  const logs = [];

  return {
    logs,
    error: error => logs.push({error}),
    info: info => logs.push({info}),
  };
};

const makeArgs = override => {
  const args = {
    fs: {getFile: (path, cbk) => cbk(new Error('NoFile'))},
    lnd: makeLnd({outcomes: [true]}),
    logger: makeLogger(),
    to: [],
  };

  Object.keys(override).forEach(key => args[key] = override[key]);

  return args;
};

const tests = [
  {
    args: makeArgs({fs: undefined}),
    description: 'Filesystem methods are required',
    error: [400, 'ExpectedFsMethodsToManageFees'],
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is required',
    error: [400, 'ExpectedLndToManageFees'],
  },
  {
    args: makeArgs({logger: undefined}),
    description: 'A logger is required',
    error: [400, 'ExpectedLoggerToManageFees'],
  },
  {
    args: makeArgs({repeat_interval_ms: ['1*h', '2*h']}),
    description: 'A single repeat interval is required',
    error: [400, 'ExpectedSingleRepeatIntervalValue'],
  },
  {
    args: makeArgs({repeat_interval_ms: '1*fortnight'}),
    description: 'The repeat interval formula must be valid',
    error: [
      400,
      'FailedToParseRepeatIntervalFormula',
      {failure: 'ExpectedAllKnownConstantsInFormulaToEvaluate'},
    ],
  },
  {
    args: makeArgs({repeat_interval_ms: '1*min * 2^FAILURES_COUNT'}),
    description: 'The repeat interval cannot depend on a failures count',
    error: [
      400,
      'FailedToParseRepeatIntervalFormula',
      {failure: 'ExpectedAllKnownConstantsInFormulaToEvaluate'},
    ],
  },
  {
    args: makeArgs({repeat_interval_ms: '-1*h'}),
    description: 'The repeat interval must not be negative',
    error: [
      400,
      'FailedToParseRepeatIntervalFormula',
      {failure: 'ExpectedNonNegativeIntervalFromFormula'},
    ],
  },
  {
    args: makeArgs({fee_rate: '100'}),
    description: 'A fee adjustment error is returned when not repeating',
    error: [400, 'SettingGlobalFeeRateNotSupported'],
  },
  {
    args: makeArgs({}),
    description: 'Fees are adjusted once when not repeating',
    expected: {rows: [header]},
    logs: [],
  },
  {
    args: makeArgs({
      lnd: makeLnd({outcomes: [false, true, false]}),
      repeat_interval_ms: '2',
    }),
    description: 'The fees are adjusted again after the interval elapses',
    logs: [
      {error: lndError},
      {info: repeatLog},
      {info: feesTable},
      {info: repeatLog},
      {error: lndError},
      {info: repeatLog},
    ],
  },
];

tests.forEach(({args, description, error, expected, logs}) => {
  return test(description, async t => {
    // Stop the clock so that the logged repeat times are known
    t.mock.timers.enable({apis: ['Date'], now});

    if (!!error) {
      await rejects(manageFees(args), error, 'Got expected error');
    } else if (!!expected) {
      deepEqual(await manageFees(args), expected, 'Got expected result');
    } else {
      // Repeating fees never finish on their own, wait for repeats to happen
      manageFees(args);

      await delay(repeatsWaitMs);
    }

    if (!!logs) {
      deepEqual(args.logger.logs, logs, 'Got expected logs');
    }

    return;
  });
});
