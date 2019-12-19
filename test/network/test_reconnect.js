const {test} = require('tap');

const {getNodeInfoResponse} = require('./../fixtures');
const {listChannelsResponse} = require('./../fixtures');
const {listPeersResponse} = require('./../fixtures');
const {reconnect} = require('./../../network');

const makeLnd = ({getNodeErr}) => {
  return {
    default: {
      connectPeer: ({}, cbk) => cbk(),
      getNodeInfo: ({}, cbk) => cbk(getNodeErr, getNodeInfoResponse),
      listChannels: ({}, cbk) => cbk(null, listChannelsResponse),
      listPeers: ({}, cbk) => cbk(null, listPeersResponse),
    },
  };
};

const tests = [
  {
    args: {},
    description: 'An LND object is expected',
    error: 'ExpectedLndToReconnectToDisconnectedPeers',
  },
  {
    args: {lnd: makeLnd({}), retries: 1},
    description: 'Peers are reconnected',
    expected: [{
      alias: 'alias',
      public_key: '000000000000000000000000000000000000000000000000000000000000000000',
    }],
  },
  {
    args: {lnd: makeLnd({getNodeErr: 'err'}), retries: 1},
    description: 'Error getting node means no reconnect',
    expected: [],
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({deepIs, end, rejects}) => {
    if (!!error) {
      await rejects(reconnect(args), error, 'Got expected error');
    } else {
      const {reconnected} = reconnect(args);

      deepIs(reconnected, expected.reconnected, 'Got expected reconnections');
    }

    return end();
  });
});
