const {test} = require('@alexbosworth/tap');

const method = require('./../../wallets/channels_as_report_activity');

const tests = [
  {
    args: {
      backups: [],
      chain: {
        currency: 'currency',
        height: 1,
        network: 'ltcmainnet',
      },
      channels: [],
      days: 1,
      nodes: [],
    },
    description: 'No channels generates no activity',
    expected: {},
  },
  {
    args: {
      backups: [
        {backup: '02', transaction_id: '01', transaction_vout: 1},
        {backup: '01', transaction_id: '00', transaction_vout: 2},
        {backup: '00', transaction_id: '00', transaction_vout: 1},
      ],
      chain: {
        currency: 'currency',
        height: 1,
        network: 'network',
      },
      channels: [{
        id: '1x1x1',
        local_balance: 1,
        partner_public_key: 'a',
        remote_balance: 1,
        transaction_id: '00',
        transaction_vout: 1,
      }],
      days: 1,
      nodes: [{alias: 'alias', public_key: 'a'}],
      now: () => 1,
    },
    description: 'A channel open returns liquidity',
    expected: {
      activity: {
        date: '1970-01-01T00:00:00.001Z',
        elements: [
          {
            subtitle: 'a few seconds ago',
            title: 'alias',
          },
          {
            action: 'Opened channel',
          },
          {
            details: 'Liquidity now 0.00000001 currency inbound, 0.00000001 currency outbound',
          },
          {
            details: 'Backup: 00:1 00',
          },
        ],
      },
    },
  },
  {
    args: {
      backups: [
        {backup: '02', transaction_id: '01', transaction_vout: 1},
        {backup: '01', transaction_id: '00', transaction_vout: 2},
        {backup: '00', transaction_id: '00', transaction_vout: 1},
      ],
      chain: {
        currency: 'currency',
        height: 1,
        network: 'network',
      },
      channels: [{
        id: '1x1x1',
        local_balance: 1,
        partner_public_key: 'a',
        remote_balance: 1,
        transaction_id: '00',
        transaction_vout: 1,
      }],
      days: 1,
      nodes: [{public_key: 'b'}],
      now: () => 1,
    },
    description: 'A channel open with no known node',
    expected: {
      activity: {
        date: '1970-01-01T00:00:00.001Z',
        elements: [
          {
            subtitle: 'a few seconds ago',
            title: 'a',
          },
          {
            action: 'Opened channel',
          },
          {
            details: 'Liquidity now 0.00000001 currency inbound, 0.00000001 currency outbound',
          },
          {
            details: 'Backup: 00:1 00',
          },
        ],
      },
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, rejects, strictSame}) => {
    const {activity} = method(args);

    const [element] = activity;

    strictSame(element, expected.activity, 'Got expected activity');

    return end();
  });
});
