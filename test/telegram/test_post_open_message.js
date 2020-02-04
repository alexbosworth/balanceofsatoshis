const {test} = require('tap');

const {chanInfoResponse} = require('./../fixtures');
const {listChannelsResponse} = require('./../fixtures');
const {getNodeInfoResponse} = require('./../fixtures');
const {pendingChannelsResponse} = require('./../fixtures');
const postOpenMessage = require('./../../telegram/post_open_message');

const pubKey = '000000000000000000000000000000000000000000000000000000000000000000';

const makeArgs = (overrides => {
  const args = {
    capacity: 1,
    from: 'node1',
    id: 1,
    is_partner_initiated: true,
    is_private: true,
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
    description: 'Channel capacity is expected',
    error: [400, 'ExpectedCapacityToPostChannelOpenMessage'],
  },
  {
    args: makeArgs({from: ''}),
    description: 'A from node name is expected',
    error: [400, 'ExpectedFromNameToPostChannelOpenMessage'],
  },
  {
    args: makeArgs({id: ''}),
    description: 'A connected user id is expected',
    error: [400, 'ExpectedTelegramUserIdToPostChannelOpenMessage'],
  },
  {
    args: makeArgs({is_private: undefined}),
    description: 'A private indicator is expected',
    error: [400, 'ExpectedPrivateStatusToPostChannelOpenMessage'],
  },
  {
    args: makeArgs({key: ''}),
    description: 'A telegram API key is expected',
    error: [400, 'ExpectedTelegramApiKeyToPostChannelOpenMessage'],
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'An LND object is expected',
    error: [400, 'ExpectedLndToPostChannelOpenMessage'],
  },
  {
    args: makeArgs({partner_public_key: ''}),
    description: 'The public key of the channel peer is expected',
    error: [400, 'ExpectedPartnerPublicKeyToPostChanOpenMessage'],
  },
  {
    args: makeArgs({request: undefined}),
    description: 'A request function is expected',
    error: [400, 'ExpectedRequestFunctionToPostChanOpenMessage'],
  },
  {
    args: makeArgs({}),
    description: 'Post channel open message to Telegram',
    expected: {
      text: [
        '🌹 node1',
        `Accepted new 0.00000001 private channel from alias ${pubKey}. Inbound liquidity now: 0.00000002. Outbound liquidity now: 0.00000002.`,
      ],
    },
  },
  {
    args: makeArgs({is_partner_initiated: false, is_private: false}),
    description: 'Post channel open message to Telegram for self-channel',
    expected: {
      text: [
        '🌹 node1',
        `Opened new 0.00000001 channel to alias ${pubKey}. Inbound liquidity now: 0.00000002. Outbound liquidity now: 0.00000002.`,
      ],
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({deepIs, end, rejects}) => {
    if (!!error) {
      rejects(postOpenMessage(args), error, 'Got expected error');
    } else {
      const {text} = await postOpenMessage(args);

      deepIs(text.split('\n'), expected.text, 'Got expected open message');
    }

    return end();
  });
});
