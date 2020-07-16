const {test} = require('@alexbosworth/tap');

const {chanInfoResponse} = require('./../fixtures');
const {getFeesChart} = require('./../../routing');
const {getNodeInfoResponse} = require('./../fixtures');

const lnds = [{
  default: {
    forwardingHistory: ({}, cbk) => cbk(null, {
      forwarding_events: [],
      last_offset_index: '0',
    }),
    getChanInfo: ({}, cbk) => cbk(null, chanInfoResponse),
    getNodeInfo: ({}, cbk) => cbk(null, getNodeInfoResponse),
    listChannels: ({}, cbk) => cbk(null, {channels: []}),
  },
}];

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
    args: {lnds, days: 1},
    description: 'Fee earnings chart data is returned',
    expected: {
      data: '0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0',
      title: 'Routing fees earned',
    },
  },
  {
    args: {
      days: 100,
      lnds: [{
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
                features: {},
                last_update: '1',
                pub_key: Buffer.alloc(33).toString('hex'),
              },
              num_channels: 1,
              total_capacity: '1',
            });
          },
          listChannels: ({}, cbk) => cbk(null, {channels: []}),
        },
      }],
      via: Buffer.alloc(33).toString('hex'),
    },
    description: 'No alias uses pubkey instead',
    expected: {
      data: '0,0,0,0,0,0,0,0,0,0,0,0,0,0',
      title: 'Routing fees earned via 000000000000000000000000000000000000000000000000000000000000000000',
    },
  },
  {
    args: {lnds, days: 7},
    description: 'Fee earnings chart data over a week is returned',
    expected: {data: '0,0,0,0,0,0,0', title: 'Routing fees earned'},
  },
  {
    args: {lnds, days: 100, via: Buffer.alloc(33).toString('hex')},
    description: 'Fee earnings chart data via a peer is returned',
    expected: {
      data: '0,0,0,0,0,0,0,0,0,0,0,0,0,0',
      title: 'Routing fees earned via alias',
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects}) => {
    if (!!error) {
      rejects(getFeesChart(args), error, 'Got expected error');
    } else {
      const {data, description, title} = await getFeesChart(args);

      equal(data.join(','), expected.data, 'Got expected fees');
      equal(!!description, true, 'Got description');
      equal(title, expected.title, 'Got expected title');
    }

    return end();
  });
});
