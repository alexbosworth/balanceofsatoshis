const {test} = require('tap');

const {getFeesChart} = require('./../../routing');

const tests = [
  {
    args: {},
    description: 'Days duration is required to get fees chart',
    error: [400, 'ExpectedNumberOfDaysToGetFeesOverForChart'],
  },
  {
    args: {days: 1},
    description: 'LND is required to get fees chart',
    error: [400, 'ExpectedLndToGetFeesChart'],
  },
  {
    args: {
      days: 1,
      lnd: {
        default: {
          forwardingHistory: ({}, cbk) => cbk(null, {
            forwarding_events: [],
            last_offset_index: '0',
          }),
          getNodeInfo: ({}, cbk) => cbk(null, {
            channels: [],
            node: {
              addresses: [],
              alias: 'alias',
              color: '#000000',
              last_update: '1',
              pub_key: 'a',
            },
            num_channels: 1,
            total_capacity: '1',
          }),
        },
      },
    },
    description: 'Fee earnings chart data is returned',
    expected: {
      fees: '0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0',
      title: 'Routing fees earned',
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects}) => {
    if (!!error) {
      rejects(getFeesChart(args), error, 'Got expected error');
    } else {
      const {description, fees, title} = await getFeesChart(args);

      equal(!!description, true, 'Got description');
      equal(fees.join(','), expected.fees, 'Got expected fees');
      equal(title, expected.title, 'Got expected title');
    }

    return end();
  });
});
