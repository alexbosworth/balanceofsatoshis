const {deepEqual} = require('node:assert').strict;
const test = require('node:test');

const method = require('./../../swaps/parse_interval_formula');

const tests = [
  {
    args: {formula: undefined},
    description: 'A formula string is required',
    expected: {failure: 'ExpectedIntervalFormulaStringToParse'},
  },
  {
    args: {formula: ['1*h', '2*h']},
    description: 'A single formula is required',
    expected: {failure: 'ExpectedIntervalFormulaStringToParse'},
  },
  {
    args: {formula: '5000'},
    description: 'A bare number is milliseconds',
    expected: {ms: 5000},
  },
  {
    args: {formula: '0'},
    description: 'A zero interval is allowed',
    expected: {ms: 0},
  },
  {
    args: {formula: '1*second'},
    description: 'Seconds are parsed',
    expected: {ms: 1000},
  },
  {
    args: {formula: '30*S'},
    description: 'Variables are case insensitive',
    expected: {ms: 30000},
  },
  {
    args: {formula: '5*min'},
    description: 'Minutes are parsed',
    expected: {ms: 300000},
  },
  {
    args: {formula: '5*m'},
    description: 'Bare m is not a unit since it is ambiguous with million',
    expected: {failure: 'ExpectedAllKnownConstantsInFormulaToEvaluate'},
  },
  {
    args: {formula: '1*h'},
    description: 'Hours are parsed',
    expected: {ms: 3600000},
  },
  {
    args: {formula: '1.5*hours'},
    description: 'Fractional units are parsed',
    expected: {ms: 5400000},
  },
  {
    args: {formula: '2*d'},
    description: 'Days are parsed',
    expected: {ms: 172800000},
  },
  {
    args: {formula: '1*week'},
    description: 'Weeks are parsed',
    expected: {ms: 604800000},
  },
  {
    args: {formula: 'RANDBETWEEN(2, 2)*h'},
    description: 'Formula functions are supported',
    expected: {ms: 7200000},
  },
  {
    args: {formula: 'AND(RAND() >= 0, RAND() < 1) * 1*min'},
    description: 'Random values are supported',
    expected: {ms: 60000},
  },
  {
    args: {failures: 3, formula: '1*min * 2^FAILURES_COUNT'},
    description: 'Exponents are supported',
    expected: {ms: 480000},
  },
  {
    args: {failures: 3, formula: 'MIN(1*h, 1*min * POWER(2, FAILURES_COUNT))'},
    description: 'Exponential back off can be capped',
    expected: {ms: 480000},
  },
  {
    args: {failures: 2000, formula: 'MIN(1*h, 1*min * 2^FAILURES_COUNT)'},
    description: 'An uncapped exponent eventually overflows',
    expected: {failure: 'ExpectedFinitePowerResultForFormulaEvaluation'},
  },
  {
    args: {
      failures: 2000,
      formula: 'MIN(1*h, 1*min * 2^MIN(FAILURES_COUNT, 6))',
    },
    description: 'A capped exponent does not overflow',
    expected: {ms: 3600000},
  },
  {
    args: {failures: 2, formula: 'CHOOSE(FAILURES_COUNT, 5*min, 1*h)'},
    description: 'Intervals can be chosen from a schedule',
    expected: {ms: 3600000},
  },
  {
    args: {formula: '10*min * (1 + FAILURES_COUNT)'},
    description: 'Failures count is unknown when failures are not counted',
    expected: {failure: 'ExpectedAllKnownConstantsInFormulaToEvaluate'},
  },
  {
    args: {failures: 2, formula: '10*min * (1 + FAILURES_COUNT)'},
    description: 'Failures in a row are available to the formula',
    expected: {ms: 1800000},
  },
  {
    args: {failures: 3, formula: 'IF(FAILURES_COUNT > 2, 1*h, 5*min)'},
    description: 'Failures can be used in conditions',
    expected: {ms: 3600000},
  },
  {
    args: {formula: '1*minute + 30*seconds + 500'},
    description: 'Units are combined',
    expected: {ms: 90500},
  },
  {
    args: {formula: '1.4'},
    description: 'Milliseconds are rounded',
    expected: {ms: 1},
  },
  {
    args: {formula: '-1*s'},
    description: 'Negative intervals are not allowed',
    expected: {failure: 'ExpectedNonNegativeIntervalFromFormula'},
  },
  {
    args: {formula: '25*d'},
    description: 'Intervals beyond the maximum timer delay are not allowed',
    expected: {failure: 'ExpectedIntervalWithinMaximumTimerDelay'},
  },
  {
    args: {formula: '1/0'},
    description: 'Cannot divide by zero',
    expected: {failure: 'ExpectedNonZeroDivisorForFormulaEvaluation'},
  },
  {
    args: {formula: '/'},
    description: 'Formula must be valid',
    expected: {failure: 'UnexpectedPrimaryTokenForFormulaParsing'},
  },
  {
    args: {formula: '1*fortnight'},
    description: 'Formula variables must be known',
    expected: {failure: 'ExpectedAllKnownConstantsInFormulaToEvaluate'},
  },
];

tests.forEach(({args, description, expected}) => {
  return test(description, (t, end) => {
    deepEqual(method(args), expected, 'Got expected result');

    return end();
  });
});
