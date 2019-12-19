const {test} = require('tap');

const {listChannelsResponse} = require('./../fixtures');
const {getNodeInfoResponse} = require('./../fixtures');
const {getPeerLiquidity} = require('./../../balances');
const {pendingChannelsResponse} = require('./../fixtures');

const tests = [
  {
    args: {},
    description: 'LND is required',
    error: [400, 'ExpectedLndToGetPeerLiquidity'],
  },
  {
    args: {lnd: {}},
    description: 'A public key is required',
    error: [400, 'ExpectedPublicKeyToGetPeerLiquidity'],
  },
  {
    args: {
      lnd: {
        default: {
          getNodeInfo: ({}, cbk) => cbk(null, getNodeInfoResponse),
          listChannels: ({}, cbk) => cbk(null, listChannelsResponse),
          pendingChannels: ({}, cbk) => cbk(null, pendingChannelsResponse),
        },
      },
      public_key: Buffer.alloc(33).toString('hex'),
    },
    description: 'Get peer liquidity',
    expected: {alias: 'alias', inbound: 2, outbound: 2},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects}) => {
    if (!!error) {
      rejects(getPeerLiquidity(args), error, 'Got expected error');
    } else {
      const peer = await getPeerLiquidity(args);

      equal(peer.alias, expected.alias, 'Alias is returned');
      equal(peer.inbound, expected.inbound, 'Total inbound is returned');
      equal(peer.outbound, expected.outbound, 'Total outbound is returned');
    }

    return end();
  });
});
