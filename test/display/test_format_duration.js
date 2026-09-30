const {deepEqual} = require('node:assert').strict;
const test = require('node:test');

const method = require('./../../display/format_duration');

const tests = [
  {
    args: {ms: 0},
    description: 'A zero duration is formatted',
    expected: {display: '0 ms'},
  },
  {
    args: {ms: 1},
    description: 'A millisecond duration is formatted',
    expected: {display: '1 ms'},
  },
  {
    args: {ms: 1500},
    description: 'Seconds and milliseconds are formatted',
    expected: {display: '1 second 500 ms'},
  },
  {
    args: {ms: 30000},
    description: 'Seconds are formatted',
    expected: {display: '30 seconds'},
  },
  {
    args: {ms: 2820000},
    description: 'Minutes are formatted',
    expected: {display: '47 minutes'},
  },
  {
    args: {ms: 3600000},
    description: 'A single unit is singular',
    expected: {display: '1 hour'},
  },
  {
    args: {ms: 5400000},
    description: 'Hours and minutes are formatted',
    expected: {display: '1 hour 30 minutes'},
  },
  {
    args: {ms: 13642050},
    description: 'Only the two largest units are shown',
    expected: {display: '3 hours 47 minutes'},
  },
  {
    args: {ms: 3630000},
    description: 'The two largest units need not be adjacent',
    expected: {display: '1 hour 30 seconds'},
  },
  {
    args: {ms: 180000000},
    description: 'Days and hours are formatted',
    expected: {display: '2 days 2 hours'},
  },
];

tests.forEach(({args, description, expected}) => {
  return test(description, (t, end) => {
    deepEqual(method(args), expected, 'Got expected result');

    return end();
  });
});
