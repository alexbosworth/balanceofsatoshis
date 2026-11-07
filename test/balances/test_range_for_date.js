const {deepEqual} = require('node:assert').strict;
const test = require('node:test');
const {throws} = require('node:assert').strict;

const rangeForDate = require('./../../balances/range_for_date');

const pinnedNow = '2021-06-15T12:00:00.000Z';

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
      after: '2019-01-01T00:00:00.000Z',
      before: '2019-02-01T00:00:00.000Z',
    },
  },
  {
    args: {year: 2019, month: 'Jan'},
    description: 'Jan 2019 year returns Jan 2019',
    expected: {
      after: '2019-01-01T00:00:00.000Z',
      before: '2019-02-01T00:00:00.000Z',
    },
  },
  {
    args: {year: 2019},
    description: 'A year by itself is valid',
    expected: {
      after: '2019-01-01T00:00:00.000Z',
      before: '2020-01-01T00:00:00.000Z',
    },
  },
  {
    args: {month: 'January'},
    description: 'A month by itself is in the current year',
    expected: {
      after: '2021-01-01T00:00:00.000Z',
      before: '2021-02-01T00:00:00.000Z',
    },
    now: '2021-06-15T12:00:00.000Z',
  },
  {
    args: {month: '02', year: 2020},
    description: 'A zero padded month number in a leap year returns the month',
    expected: {
      after: '2020-02-01T00:00:00.000Z',
      before: '2020-03-01T00:00:00.000Z',
    },
  },
  {
    args: {month: 'February', year: 2019},
    description: 'A full month name returns the month',
    expected: {
      after: '2019-02-01T00:00:00.000Z',
      before: '2019-03-01T00:00:00.000Z',
    },
  },
  {
    args: {date: '15', month: '1', year: 2019},
    description: 'A date returns a single day range',
    expected: {
      after: '2019-01-15T00:00:00.000Z',
      before: '2019-01-16T00:00:00.000Z',
    },
  },
  {
    args: {date: '31', month: '12', year: 2019},
    description: 'The last day of the year ends at the start of the next year',
    expected: {
      after: '2019-12-31T00:00:00.000Z',
      before: '2020-01-01T00:00:00.000Z',
    },
  },
  {
    args: {date: '5', year: 2019},
    description: 'A date without a month is in the first month of the year',
    expected: {
      after: '2019-01-05T00:00:00.000Z',
      before: '2019-01-06T00:00:00.000Z',
    },
  },
  {
    args: {date: '1', month: '3'},
    description: 'A date and month without a year is in the current year',
    expected: {
      after: '2021-03-01T00:00:00.000Z',
      before: '2021-03-02T00:00:00.000Z',
    },
    now: '2021-06-15T12:00:00.000Z',
  },
  {
    args: {month: '12'},
    description: 'Without a year, the current year is the year in UTC',
    expected: {
      after: '2021-12-01T00:00:00.000Z',
      before: '2022-01-01T00:00:00.000Z',
    },
    now: '2021-01-01T07:30:00.000Z',
  },
  {
    args: {month: '12', year: 2019},
    description: 'December ends at the start of the next year',
    expected: {
      after: '2019-12-01T00:00:00.000Z',
      before: '2020-01-01T00:00:00.000Z',
    },
  },
  {
    args: {date: '29', month: '2', year: 2020},
    description: 'A leap day returns a single day range',
    expected: {
      after: '2020-02-29T00:00:00.000Z',
      before: '2020-03-01T00:00:00.000Z',
    },
  },
  {
    args: {month: '10', year: '2019'},
    description: 'Strings as passed from the command line return the month',
    expected: {
      after: '2019-10-01T00:00:00.000Z',
      before: '2019-11-01T00:00:00.000Z',
    },
  },
  {
    args: {date: '05', month: '1', year: 2019},
    description: 'A zero padded date returns the day',
    expected: {
      after: '2019-01-05T00:00:00.000Z',
      before: '2019-01-06T00:00:00.000Z',
    },
  },
  {
    args: {date: '30', month: '2', year: 2020},
    description: 'A date has to be a day in the month',
    error: 'ExpectedDayInMonthForAccountingDate',
  },
  {
    args: {date: '29', month: '2', year: 2019},
    description: 'A leap day has to be in a leap year',
    error: 'ExpectedDayInMonthForAccountingDate',
  },
  {
    args: {date: '0', month: '1', year: 2019},
    description: 'A date of zero is not a day in the month',
    error: 'ExpectedDayInMonthForAccountingDate',
  },
  {
    args: {date: 'abc', month: '1', year: 2019},
    description: 'A date has to be a whole number',
    error: 'ExpectedDayInMonthForAccountingDate',
  },
  {
    args: {date: '999999999', month: '1', year: 2019},
    description: 'A date far past the end of the month is not a day in it',
    error: 'ExpectedDayInMonthForAccountingDate',
  },
];

tests.forEach(({args, description, error, expected, now}) => {
  return test(description, ({mock}, end) => {
    mock.timers.enable({apis: ['Date'], now: Date.parse(now || pinnedNow)});

    if (!!error) {
      throws(() => rangeForDate(args), new Error(error), 'Got expected error');
    } else {
      deepEqual(rangeForDate(args), expected, 'Got expected date range');
    }

    return end();
  });
});
