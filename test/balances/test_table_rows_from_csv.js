const {test} = require('tap');

const tableRowsFromCsv = require('./../../balances/table_rows_from_csv');

const tests = [
  {
    args: {},
    description: 'No csv results in no rows',
    expected: {rows: [[]]},
  },
  {
    args: {csv: ',,,\n\n,'},
    description: 'An invalid csv results an error',
    error: [400, 'FailedToParseCsv'],
  },
  {
    args: {
      csv: '"1st","2nd","3rd"\n"foo",0.123456,"1"\n"baz",0.123456,"3"\n"bar",0.123456,"2"',
    },
    description: 'No csv results in no rows',
    expected: {
      rows: [
        ['1st', '2nd', '3rd'],
        ['foo', '0.123456', '1'],
        ['bar', '0.123456', '2'],
        ['baz', '0.123456', '3'],
      ],
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({deepIs, end, equal, rejects}) => {
    if (!!error) {
      await rejects(tableRowsFromCsv(args), error, 'Got expected error');
    } else {
      const {rows} = await tableRowsFromCsv(args);

      deepIs(rows, expected.rows, 'Got expected table rows');
    }

    return end();
  });
});
