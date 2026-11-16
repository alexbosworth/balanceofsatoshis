const {deepEqual} = require('node:assert').strict;
const test = require('node:test');
const {throws} = require('node:assert').strict;

const showSignedClaims = require('./../../swaps/show_signed_claims');
const {swapOutSafetyNotes} = require('./../../swaps/constants');

// Fee rates of a claims schedule that rises as the deadline nears
const rates = [1, 2, 4, 6, 8, 9, 10, 11, 12, 14, 30, 50, 90];

const claims = rates.map((rate, i) => ({
  fee_rate: rate,
  height: 100 + i,
  transaction: `tx${i}`,
}));

const showing = count => `${count}, ${swapOutSafetyNotes.claims_shown}`;
const withRates = list => claims.filter(n => list.includes(n.fee_rate));

// A logger that keeps the lines that it logs
const makeLogger = () => {
  const lines = [];

  return {lines, info: line => lines.push(line)};
};

const makeArgs = overrides => {
  const args = {claims, fee_rate: 10, logger: makeLogger()};

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const makeExpected = overrides => {
  const expected = {
    note: swapOutSafetyNotes.claims,
    current_fee_rate: 10,
    showing: showing('7 of 13'),
    transactions: withRates([8, 9, 10, 11, 12, 30, 90]),
  };

  Object.keys(overrides).forEach(k => expected[k] = overrides[k]);

  return [{signed_claims: expected}];
};

const tests = [
  {
    args: makeArgs({claims: undefined}),
    description: 'Claims are expected',
    error: 'ExpectedArrayOfSignedClaimsToShow',
  },
  {
    args: makeArgs({logger: undefined}),
    description: 'A logger is expected',
    error: 'ExpectedLoggerToShowSignedClaims',
  },
  {
    args: makeArgs({}),
    description: 'Claims near the current fee rate are shown, then doublings',
    expected: makeExpected({}),
  },
  {
    args: makeArgs({
      claims: [{fee_rate: 63.628571428571426, height: 100, transaction: 'tx'}],
    }),
    description: 'Claim fee rates are shown rounded down',
    expected: makeExpected({
      showing: showing('1 of 1'),
      transactions: [{fee_rate: 63.62, height: 100, transaction: 'tx'}],
    }),
  },
  {
    args: makeArgs({fee_rate: undefined}),
    description: 'Without the current fee rate claims show from the lowest',
    expected: makeExpected({
      current_fee_rate: undefined,
      showing: showing('6 of 13'),
      transactions: withRates([1, 2, 4, 8, 30, 90]),
    }),
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, () => {
    if (!!error) {
      throws(() => showSignedClaims(args), new Error(error), 'Got error');
    } else {
      // The claims are logged by the time showing them returns
      showSignedClaims(args);

      deepEqual(args.logger.lines, expected, 'Got expected output');
    }

    return;
  });
});
