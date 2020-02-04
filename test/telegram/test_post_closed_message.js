const {test} = require('tap');

const {chanInfoResponse} = require('./../fixtures');
const {listChannelsResponse} = require('./../fixtures');
const {getNodeInfoResponse} = require('./../fixtures');
const {pendingChannelsResponse} = require('./../fixtures');
const postClosedMessage = require('./../../telegram/post_closed_message');

const pubKey = '000000000000000000000000000000000000000000000000000000000000000000';

const makeArgs = (overrides => {
  const args = {
    capacity: 1,
    from: 'node1',
    id: 1,
    is_breach_close: false,
    is_cooperative_close: false,
    is_local_force_close: false,
    is_remote_force_close: false,
    key: 'key',
    lnd: {
      default: {
        getChanInfo: ({}, cbk) => cbk(null, chanInfoResponse),
        getNodeInfo: ({}, cbk) => cbk(null, getNodeInfoResponse),
        listChannels: ({}, cbk) => cbk(null, listChannelsResponse),
        pendingChannels: ({}, cbk) => cbk(null, pendingChannelsResponse),
      },
    },
    partner_public_key: pubKey,
    request: ({}, cbk) => cbk(null, {statusCode: 200}),
  };

  Object.keys(overrides).forEach(key => args[key] = overrides[key]);

  return args;
});

const tests = [
  {
    args: makeArgs({capacity: undefined}),
    description: 'Capacity is required',
    error: [400, 'ExpectedChannelCapacityToPostClosedMessage'],
  },
  {
    args: makeArgs({from: ''}),
    description: 'From node name is required',
    error: [400, 'ExpectedFromNodeToPostClosedMessage'],
  },
  {
    args: makeArgs({id: ''}),
    description: 'Connected user id is required',
    error: [400, 'ExpectedConnectedUserIdToPostClosedMessage'],
  },
  {
    args: makeArgs({is_breach_close: undefined}),
    description: 'Breach close status is required',
    error: [400, 'ExpectedBreachCloseBoolToPostClosedMessage'],
  },
  {
    args: makeArgs({is_cooperative_close: undefined}),
    description: 'Cooperative close status is required',
    error: [400, 'ExpectedCooperativeCloseBoolToPostClosedMessage'],
  },
  {
    args: makeArgs({is_local_force_close: undefined}),
    description: 'Local force close status is required',
    error: [400, 'ExpectedLocalForceCloseStatusToPostCloseMessage'],
  },
  {
    args: makeArgs({is_remote_force_close: undefined}),
    description: 'Remote force close status is required',
    error: [400, 'ExpectedRemoteForceCloseToPostCloseMessage'],
  },
  {
    args: makeArgs({key: ''}),
    description: 'Telegram API key is required',
    error: [400, 'ExpectedTelegramApiKeyToPostCloseMessage'],
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND object is required',
    error: [400, 'ExpectedAuthenticatedLndToPostCloseMessage'],
  },
  {
    args: makeArgs({partner_public_key: undefined}),
    description: 'Partner public key is required',
    error: [400, 'ExpectedPartnerPublicKeyToPostCloseMessage'],
  },
  {
    args: makeArgs({request: undefined}),
    description: 'A request function is required',
    error: [400, 'ExpectedRequestFunctionToPostCloseMessage'],
  },
  {
    args: makeArgs({}),
    description: 'Post channel close message to Telegram',
    expected: {
      text: [
        '🥀 node1',
        `0.00000001 channel closed with alias ${pubKey}. Inbound liquidity now: 0.00000002. Outbound liquidity now: 0.00000002.`,
      ],
    },
  },
  {
    args: makeArgs({is_breach_close: true}),
    description: 'Post breach channel close message to Telegram',
    expected: {
      text: [
        '🥀 node1',
        `Breach countered on 0.00000001 channel with alias ${pubKey}. Inbound liquidity now: 0.00000002. Outbound liquidity now: 0.00000002.`,
      ],
    },
  },
  {
    args: makeArgs({is_cooperative_close: true}),
    description: 'Post cooperative channel close message to Telegram',
    expected: {
      text: [
        '🥀 node1',
        `Cooperatively closed 0.00000001 channel with alias ${pubKey}. Inbound liquidity now: 0.00000002. Outbound liquidity now: 0.00000002.`,
      ],
    },
  },
  {
    args: makeArgs({is_local_force_close: true}),
    description: 'Post local force channel close message to Telegram',
    expected: {
      text: [
        '🥀 node1',
        `Force-closed 0.00000001 channel with alias ${pubKey}. Inbound liquidity now: 0.00000002. Outbound liquidity now: 0.00000002.`,
      ],
    },
  },
  {
    args: makeArgs({is_remote_force_close: true}),
    description: 'Post remote force channel close message to Telegram',
    expected: {
      text: [
        '🥀 node1',
        `0.00000001 channel was force closed by alias ${pubKey}. Inbound liquidity now: 0.00000002. Outbound liquidity now: 0.00000002.`,
      ],
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({deepIs, end, rejects}) => {
    if (!!error) {
      rejects(postClosedMessage(args), error, 'Got expected error');
    } else {
      const {text} = await postClosedMessage(args);

      deepIs(text.split('\n'), expected.text, 'Got expected close message');
    }

    return end();
  });
});
