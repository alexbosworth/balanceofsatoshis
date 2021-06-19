const {test} = require('@alexbosworth/tap');

const avoidsAsIgnores = require('./../../swaps/avoids_as_ignores');
const {chanInfoResponse} = require('./../fixtures');
const {getNodeInfoResponse} = require('./../fixtures');

const tests = [
  {
    args: {},
    description: 'LND is expected',
    error: [400, 'ExpectedAuthenticatedLndToGetIgnoresList'],
  },
  {
    args: {lnd: {default: {}}},
    description: 'No ignores are returned from empty avoids list',
    expected: {ignore: []},
  },
  {
    args: {avoid: [Buffer.alloc(33, 2).toString('hex')], lnd: {default: {}}},
    description: 'A public key is avoided',
    expected: {
      ignore: [{from_public_key: Buffer.alloc(33, 2).toString('hex')}],
    },
  },
  {
    args: {
      avoid: ['alias'],
      channels: [{partner_public_key: Buffer.alloc(33, 2).toString('hex')}],
      lnd: {
        default: {
          getNodeInfo: ({}, cbk) => cbk(null, getNodeInfoResponse),
        },
      },
    },
    description: 'A peer is avoided',
    error: [400, 'FailedToFindPeerAliasMatch'],
  },
  {
    args: {
      avoid: ['0x0x0'],
      lnd: {
        default: {
          getChanInfo: (args, cbk) => cbk(null, chanInfoResponse),
        },
      },
    },
    description: 'A channel is avoided',
    expected: {
      ignore: [
        {
          channel: '0x0x0',
          from_public_key: '000000000000000000000000000000000000000000000000000000000000000000',
          to_public_key: '010000000000000000000000000000000000000000000000000000000000000000',
        },
        {
          channel: '0x0x0',
          from_public_key: '010000000000000000000000000000000000000000000000000000000000000000',
          to_public_key: '000000000000000000000000000000000000000000000000000000000000000000',
        },
      ],
    },
  },
  {
    args: {
      avoid: ['0x0x0'],
      lnd: {default: {getChanInfo: (args, cbk) => cbk('err')}},
    },
    description: 'A channel is avoided',
    error: [404, 'FailedToFindChannelToAvoid'],
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects, strictSame}) => {
    if (!!error) {
      await rejects(avoidsAsIgnores(args), error, 'Got expected error');
    } else {
      const res = await avoidsAsIgnores(args);

      strictSame(res, expected, 'Got expected result');
    }

    return end();
  });
});
