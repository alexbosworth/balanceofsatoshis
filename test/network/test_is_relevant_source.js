const {equal} = require('node:assert').strict;
const test = require('node:test');

const method = require('./../../network/is_relevant_source');

const tests = [
  {
    args: {all_channels: [], node_channels: []},
    description: 'An in channel should be found',
    expected: false,
  },
  {
    args: {
      all_channels: [],
      node_channels: [{
        id: '0x0x1',
        partner_public_key: Buffer.alloc(33, 1).toString('hex'),
      }],
      incoming_channel: '0x0x1',
    },
    description: 'An in channel is found',
    expected: true,
  },
  {
    args: {
      all_channels: [],
      incoming_channel: '0x0x1',
      node_channels: [{
        id: '0x0x1',
        partner_public_key: Buffer.alloc(33, 1).toString('hex'),
      }],
      to: Buffer.alloc(33, 2).toString('hex'),
    },
    description: 'An in channel is found but not the out channel',
    expected: false,
  },
  {
    args: {
      all_channels: [{
        id: '0x0x2',
        partner_public_key: Buffer.alloc(33, 2).toString('hex'),
      }],
      incoming_channel: '0x0x1',
      node_channels: [{
        id: '0x0x1',
        partner_public_key: Buffer.alloc(33, 1).toString('hex'),
      }],
      outgoing_channel: '0x0x2',
      to: Buffer.alloc(33, 2).toString('hex'),
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
      from: Buffer.alloc(33, 2).toString('hex'),
      incoming_channel: '0x0x1',
      node_channels: [{
        id: '0x0x1',
        partner_public_key: Buffer.alloc(33, 1).toString('hex'),
      }],
    },
    description: 'An fromo channel should be the node channel',
    expected: false,
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, (t, end) => {
    const got = method(args);

    equal(got, expected, 'Got expected result');

    return end();
  });
});
