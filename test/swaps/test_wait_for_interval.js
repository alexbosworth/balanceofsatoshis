const {rejects} = require('node:assert').strict;
const test = require('node:test');

const waitForInterval = require('./../../swaps/wait_for_interval');

const hourMs = 1000 * 60 * 60;
const intervalError = [400, 'ExpectedIntervalMillisecondsToWaitFor'];
const now = Date.UTC(2020, 0, 1, 12);

const makeArgs = overrides => {
  const args = {ms: 0};

  Object.keys(overrides).forEach(key => args[key] = overrides[key]);

  return args;
};

const tests = [
  {
    args: makeArgs({ms: undefined}),
    description: 'An interval is required',
    error: intervalError,
    slept: 0,
  },
  {
    args: makeArgs({ms: -1}),
    description: 'An interval is not negative',
    error: intervalError,
    slept: 0,
  },
  {
    args: makeArgs({}),
    description: 'A wait for no interval is over at once',
    slept: 0,
  },
  {
    args: makeArgs({ms: 5}),
    description: 'A wait is over when the interval elapses',
    slept: 0,
  },
  {
    args: makeArgs({ms: hourMs}),
    description: 'A wait is over after sleeping through the interval',
    slept: hourMs,
  },
];

tests.forEach(({args, description, error, slept}) => {
  return test(description, async ({mock}) => {
    // Only the clock is mocked, so moving it is like sleep for real timers
    mock.timers.enable({apis: ['Date'], now});

    const waiting = waitForInterval(args);

    mock.timers.setTime(now + slept);

    if (!!error) {
      await rejects(waiting, error, 'Got expected error');
    } else {
      await waiting;
    }

    return;
  });
});
