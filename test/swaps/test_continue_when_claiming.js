const {deepEqual} = require('node:assert').strict;
const test = require('node:test');

const continueWhenClaiming = require('./../../swaps/continue_when_claiming');

const paymentError = [503, 'FailedToPayFundingPaymentRequest'];

// Arguments with a callback and a logger that keep what they are given
const makeArgs = overrides => {
  const kept = {errors: [], outcome: []};

  const args = {
    kept,
    cbk: (err, res) => kept.outcome.push(err, res),
    claiming: {is_claiming: false},
    logger: {error: line => kept.errors.push(line)},
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const makeExpected = overrides => {
  const expected = {errors: [], outcome: [paymentError, undefined]};

  Object.keys(overrides).forEach(k => expected[k] = overrides[k]);

  return expected;
};

const tests = [
  {
    args: makeArgs({}),
    description: 'A payment error stops a swap that is not claiming',
    expected: makeExpected({}),
    finish: [paymentError],
  },
  {
    args: makeArgs({}),
    description: 'A payment result is passed on',
    expected: makeExpected({outcome: [undefined, {mtokens: '1000'}]}),
    finish: [undefined, {mtokens: '1000'}],
  },
  {
    args: makeArgs({claiming: {is_claiming: true}}),
    description: 'A payment error does not stop a swap that is claiming',
    expected: makeExpected({
      errors: [{payment_failed_while_claiming: paymentError}],
      outcome: [undefined, undefined],
    }),
    finish: [paymentError],
  },
];

tests.forEach(({args, description, expected, finish}) => {
  return test(description, () => {
    continueWhenClaiming(args).finished(...finish);

    deepEqual(args.kept, expected, 'Got expected outcome');

    return;
  });
});
