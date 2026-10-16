const {deepEqual} = require('node:assert').strict;
const {equal} = require('node:assert').strict;
const test = require('node:test');
const {throws} = require('node:assert').strict;

const rangeForDate = require('./../../balances/range_for_date');

const tests = [
  {
    args: {},
    description: 'No month or year returns no restrictions',
    expected: {},
  },
  {
    args: {year: 2019, month: '1'},
    description: 'First month and 2019 year returns Jan 2019',
    expected: {
      after: '2018-12-31T23:59:59.999Z',
      before: '2019-02-01T00:00:00.000Z',
    },
  },
  {
    args: {year: 2019, month: 'Jan'},
    description: 'Jan 2019 year returns Jan 2019',
    expected: {
      after: '2018-12-31T23:59:59.999Z',
      before: '2019-02-01T00:00:00.000Z',
    },
  },
  {
    args: {year: 2019},
    description: 'A year by itself is valid',
    expected: {
      after: '2018-12-31T23:59:59.999Z',
      before: '2020-01-01T00:00:00.000Z',
    },
  },
  {
    args: {month: 'January'},
    description: 'A month by itself is valid',
  },
  {
    args: {month: '02', year: 2020},
    description: 'A zero padded month number in a leap year returns the month',
    expected: {
      after: '2020-01-31T23:59:59.999Z',
      before: '2020-03-01T00:00:00.000Z',
    },
  },
  {
    args: {month: 'February', year: 2019},
    description: 'A full month name returns the month',
    expected: {
      after: '2019-01-31T23:59:59.999Z',
      before: '2019-03-01T00:00:00.000Z',
    },
  },
  {
    args: {date: '15', month: '1', year: 2019},
    description: 'A date returns a single day range',
    expected: {
      after: '2019-01-14T23:59:59.999Z',
      before: '2019-01-16T00:00:00.000Z',
    },
  },
  {
    args: {date: '31', month: '12', year: 2019},
    description: 'The last day of the year ends at the start of the next year',
    expected: {
      after: '2019-12-30T23:59:59.999Z',
      before: '2020-01-01T00:00:00.000Z',
    },
  },
  {
    args: {date: '5', year: 2019},
    description: 'A date without a month is in the first month of the year',
    expected: {
      after: '2019-01-04T23:59:59.999Z',
      before: '2019-01-06T00:00:00.000Z',
    },
  },
  {
    args: {date: '1', month: '3'},
    description: 'A date and month without a year is valid',
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, (t, end) => {
    if (!!error) {
      throws(() => rangeForDate(args), new Error(error), 'Got expected error');
    } else if (!args.year && !!args.month) {
      equal(!!rangeForDate(args).after, true, 'Got expected after date');
      equal(!!rangeForDate(args).before, true, 'Got expected before date');
    } else {
      deepEqual(rangeForDate(args), expected, 'Got expected date range');
    }

    return end();
  });
});
