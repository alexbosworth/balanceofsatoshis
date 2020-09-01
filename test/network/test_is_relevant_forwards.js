const {test} = require('tap');

const method = require('./../../network/is_relevant_forward');

const tests = [
  {
    args: {all_channels: [], node_channels: []},
    description: 'An out channel should be found',
    expected: false,
  },
  {
    args: {
      all_channels: [],
      node_channels: [{
        id: '0x0x1',
        partner_public_key: Buffer.alloc(33, 1).toString('hex'),
      }],
      outgoing_channel: '0x0x1',
    },
    description: 'An out channel is found',
    expected: true,
  },
  {
    args: {
      all_channels: [],
      from: Buffer.alloc(33, 2).toString('hex'),
      node_channels: [{
        id: '0x0x1',
        partner_public_key: Buffer.alloc(33, 1).toString('hex'),
      }],
      outgoing_channel: '0x0x1',
    },
    description: 'An out channel is found but not the in channel',
    expected: false,
  },
  {
    args: {
      all_channels: [{
        id: '0x0x2',
        partner_public_key: Buffer.alloc(33, 2).toString('hex'),
      }],
      from: Buffer.alloc(33, 2).toString('hex'),
      incoming_channel: '0x0x2',
      node_channels: [{
        id: '0x0x1',
        partner_public_key: Buffer.alloc(33, 1).toString('hex'),
      }],
      outgoing_channel: '0x0x1',
    },
    description: 'An out channel is found and the in channel is found too',
    expected: true,
  },
  {
    args: {
      all_channels: [{
        id: '0x0x2',
        partner_public_key: Buffer.alloc(33, 2).toString('hex'),
      }],
      node_channels: [{
        id: '0x0x1',
        partner_public_key: Buffer.alloc(33, 1).toString('hex'),
      }],
      outgoing_channel: '0x0x1',
      to: Buffer.alloc(33, 2).toString('hex'),
    },
    description: 'An to channel should be the node channel',
    expected: false,
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, throws}) => {
    const got = method(args);

    equal(got, expected, 'Got expected result');

    return end();
  });
});
