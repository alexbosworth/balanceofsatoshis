const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const manageRebalance = require('./../../swaps/manage_rebalance');

// Logged times are local times, so use a fixed time zone to make them known
process.env.TZ = 'UTC';

const now = Date.UTC(2020, 0, 1, 12);
const rebalanceError = {err: [400, 'MultipleInPeersIsNotSupported']};

// The log of the next repeat, showing the interval and the time it is due
const repeatLog = interval => ({
  repeat_interval: interval,
  repeating_rebalance_at: 'Today at 12:00 PM',
});

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
    lnd: {default: {}},
    logger: makeLogger(),
  };

  Object.keys(override).forEach(key => args[key] = override[key]);

  return args;
};

const tests = [
  {
    args: makeArgs({avoid_append: 'FAILURE_INDEX = 1'}),
    description: 'An avoid list is required to append avoids',
    error: [400, 'ExpectedAvoidListToAppendAvoidsTo'],
  },
  {
    args: makeArgs({fs: undefined}),
    description: 'Filesystem methods are required',
    error: [400, 'ExpectedFsToManageRebalance'],
  },
  {
    args: makeArgs({logger: undefined}),
    description: 'A logger is required',
    error: [400, 'ExpectedLoggerToManageRebalance'],
  },
  {
    args: makeArgs({max_fee: ['1', '2']}),
    description: 'A single max fee is required',
    error: [400, 'ExpectedSingleMaxFeeValue'],
  },
  {
    args: makeArgs({max_fee_rate: ['1', '2']}),
    description: 'A single max fee rate is required',
    error: [400, 'ExpectedSingleMaxFeeValue'],
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is required',
    error: [400, 'ExpectedLndToManageRebalance'],
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
    args: makeArgs({repeat_interval_ms: '-1*h'}),
    description: 'The repeat interval must not be negative',
    error: [
      400,
      'FailedToParseRepeatIntervalFormula',
      {failure: 'ExpectedNonNegativeIntervalFromFormula'},
    ],
  },
  {
    args: makeArgs({in_through: ['a', 'b']}),
    description: 'A rebalance error is returned when not repeating',
    error: [400, 'MultipleInPeersIsNotSupported'],
    logs: [],
  },
  {
    args: makeArgs({
      in_through: ['a', 'b'],
      repeat_interval_ms: 'CHOOSE(FAILURES_COUNT + 1, 1, 2, 3, 4)',
    }),
    description: 'The rebalance is repeated after the interval elapses',
    error: [
      400,
      'FailedToEvaluateRepeatInterval',
      {failure: 'ExpectedIndexWithinValuesForChooseFunctionEvaluation'},
    ],
    logs: [
      {error: rebalanceError},
      {info: repeatLog('2 ms')},
      {error: rebalanceError},
      {info: repeatLog('3 ms')},
      {error: rebalanceError},
      {info: repeatLog('4 ms')},
      {error: rebalanceError},
    ],
  },
];

tests.forEach(({args, description, error, expected, logs}) => {
  return test(description, async t => {
    // Stop the clock so that the logged repeat times are known
    t.mock.timers.enable({apis: ['Date'], now});

    if (!!error) {
      await rejects(manageRebalance(args), error, 'Got expected error');
    } else {
      deepEqual(await manageRebalance(args), expected, 'Got expected result');
    }

    if (!!logs) {
      deepEqual(args.logger.logs, logs, 'Got expected logs');
    }

    return;
  });
});
