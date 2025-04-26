const {deepEqual} = require('node:assert').strict;
const test = require('node:test');

const method = require('./../../wallets/report_overview');

const report = [
  {
    subtitle: 'current status',
    title: 'Node',
  },
  {
    details: 'public_key',
  },
  {
    details: 'alias',
  },
  {
    details: '0.00000001 CURRENCY',
  },
  {},
  {
    subtitle: '55 years ago',
    title: 'Last Block:',
  },
  {
    subtitle: '100%',
    title: 'Funds on Lightning',
  },
  {
    subtitle: '1 per vbyte',
    title: 'Confirmation Fee:',
  },
];

const tests = [
  {
    args: {
      alias: 'alias',
      balance: 1,
      chain_fee: 1,
      channel_balance: 1,
      currency: 'CURRENCY',
      latest_block_at: new Date(1).toISOString(),
      public_key: 'public_key',
      rate: 100,
    },
    description: 'An overview is generated',
    expected: {report},
  },
  {
    args: {
      alias: 'alias',
      balance: 1,
      channel_balance: 1,
      currency: 'CURRENCY',
      latest_block_at: new Date(1).toISOString(),
      public_key: 'public_key',
      rate: 100,
    },
    description: 'An overview is generated when no chainfee is specified',
    expected: {report: report.filter(n => n.title !== 'Confirmation Fee:')},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, (t, end) => {
    const {report} = method(args);

    deepEqual(report, expected.report, 'Got expected report');

    return end();
  });
});
