const {test} = require('tap');

const {getFeesChart} = require('./../../routing');
const {getNodeInfoResponse} = require('./../network/fixtures');

const lnd = {
  default: {
    forwardingHistory: ({}, cbk) => cbk(null, {
      forwarding_events: [],
      last_offset_index: '0',
    }),
    getNodeInfo: ({}, cbk) => cbk(null, getNodeInfoResponse),
    listChannels: ({}, cbk) => cbk(null, {channels: []}),
  },
};

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
    args: {lnd, days: 1},
    description: 'Fee earnings chart data is returned',
    expected: {
      fees: '0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0',
      title: 'Routing fees earned',
    },
  },
  {
    args: {
      days: 100,
      lnd: {
        default: {
          forwardingHistory: ({}, cbk) => cbk(null, {
            forwarding_events: [],
            last_offset_index: '0',
          }),
          getNodeInfo: ({}, cbk) => {
            return cbk(null, {
              channels: [],
              node: {
                addresses: [],
                alias: '',
                color: '#000000',
                last_update: '1',
                pub_key: 'a',
              },
              num_channels: 1,
              total_capacity: '1',
            });
          },
          listChannels: ({}, cbk) => cbk(null, {channels: []}),
        },
      },
      via: 'a',
    },
    description: 'No alias uses pubkey instead',
    expected: {
      fees: '0,0,0,0,0,0,0,0,0,0,0,0,0,0',
      title: 'Routing fees earned via a',
    },
  },
  {
    args: {lnd, days: 7},
    description: 'Fee earnings chart data over a week is returned',
    expected: {fees: '0,0,0,0,0,0,0', title: 'Routing fees earned'},
  },
  {
    args: {lnd, days: 100, via: 'a'},
    description: 'Fee earnings chart data via a peer is returned',
    expected: {
      fees: '0,0,0,0,0,0,0,0,0,0,0,0,0,0',
      title: 'Routing fees earned via alias',
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
