const {test} = require('tap');

const {chanInfoResult} = require('./fixtures');
const {getInfoResponse} = require('./../fixtures');
const {nodeInfoResult} = require('./fixtures');
const notifyOfForwards = require('./../../telegram/notify_of_forwards');

const getInfoRes = () => JSON.parse(JSON.stringify(getInfoResponse));

const tests = [
  {
    args: {},
    description: 'A forwards array is required to notify of forwards',
    error: [400, 'ExpectedForwardsArrayToNotifyOfForwards'],
  },
  {
    args: {forwards: []},
    description: 'A from name is required to notify of forwards',
    error: [400, 'ExpectedFromNodeNameToNotifyOfForwards'],
  },
  {
    args: {forwards: [], from: 'from'},
    description: 'A user id is required to notify of forwards',
    error: [400, 'ExpectedConnectedUserIdToNotifyOfForwards'],
  },
  {
    args: {forwards: [], from: 'from', id: 1},
    description: 'A telegram key is required to notify of forwards',
    error: [400, 'ExpectedTelegramApiKeyToNotifyOfForwards'],
  },
  {
    args: {forwards: [], from: 'from', id: 1, key: 'key'},
    description: 'An lnd connection is required to notify of forwards',
    error: [400, 'ExpectedLndToNotifyOfForwards'],
  },
  {
    args: {forwards: [], from: 'from', id: 1, key: 'key', lnd: {}},
    description: 'A request function is required to notify of forwards',
    error: [400, 'ExpectedRequestFunctionToNotifyOfForwards'],
  },
  {
    args: {
      forwards: [],
      from: 'from',
      id: 1,
      key: 'key',
      lnd: {},
      request: ({}, cbk) => {},
    },
    description: 'No forwards yields no notifications',
  },
  {
    args: {
      forwards: [{
        fee: 1, 
        incoming_channel: '0x0x1',
        outgoing_channel: '1x1x1',
        tokens: 1,
      }],
      from: 'from',
      id: 1,
      key: 'key',
      lnd: {
        default: {
          getChanInfo: (args, cbk) => cbk(null, chanInfoResult),
          getInfo: ({}, cbk) => cbk(null, getInfoRes()),
          getNodeInfo: ({}, cbk) => cbk(null, nodeInfoResult),
        },
      },
      request: ({qs}, cbk) => {
        if (qs.text !== '💰 *from*\n- Earned 1 forwarding 1 from alias to alias') {
          throw new Error('UnexpectedTextMessageSentToTelegramRequest');
        }

        return cbk(null, {statusCode: 200})
      },
    },
    description: 'A forward is mapped to a forward notification',
  },
  {
    args: {
      forwards: [{
        fee: 1, 
        incoming_channel: '0x0x1',
        outgoing_channel: '1x1x1',
        tokens: 1,
      }],
      from: 'from',
      id: 1,
      key: 'key',
      lnd: {
        default: {
          getChanInfo: (args, cbk) => cbk('err'),
          getInfo: ({}, cbk) => cbk(null, getInfoRes()),
          getNodeInfo: ({}, cbk) => cbk(null, nodeInfoResult),
        },
      },
      request: ({qs}, cbk) => {
        if (qs.text !== '💰 *from*\n- Earned 1 forwarding 1 from 0x0x1 to 1x1x1') {
          throw new Error('UnexpectedTextMessageSentToTelegramRequest');
        }

        return cbk(null, {statusCode: 200})
      },
    },
    description: 'Get channel error reverts back to channel ids',
  },
  {
    args: {
      forwards: [{
        fee: 1, 
        incoming_channel: '0x0x1',
        outgoing_channel: '1x1x1',
        tokens: 1,
      }],
      from: 'from',
      id: 1,
      key: 'key',
      lnd: {
        default: {
          getChanInfo: (args, cbk) => cbk('err'),
          getInfo: ({}, cbk) => cbk(null, getInfoRes()),
          getNodeInfo: ({}, cbk) => cbk(null, nodeInfoResult),
        },
      },
      request: ({qs}, cbk) => {
        if (qs.text !== '💰 *from*\n- Earned 1 forwarding 1 from 0x0x1 to 1x1x1') {
          throw new Error('UnexpectedTextMessageSentToTelegramRequest');
        }

        return cbk(null, {statusCode: 200})
      },
    },
    description: 'Get channel error reverts back to channel ids',
  },
  {
    args: {
      forwards: [{
        fee: 1,
        incoming_channel: '0x0x1',
        outgoing_channel: '1x1x1',
        tokens: 1,
      }],
      from: 'from',
      id: 1,
      key: 'key',
      lnd: {
        default: {
          getChanInfo: (args, cbk) => cbk(null, chanInfoResult),
          getInfo: ({}, cbk) => cbk(null, getInfoRes()),
          getNodeInfo: ({}, cbk) => cbk('err'),
        },
      },
      request: ({qs}, cbk) => {
        if (qs.text !== '💰 *from*\n- Earned 1 forwarding 1 from 0x0x1 to 1x1x1') {
          throw new Error('UnexpectedTextMessageSentToTelegramRequest');
        }

        return cbk(null, {statusCode: 200})
      },
    },
    description: 'Get ndoe error reverts back to channel ids',
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects}) => {
    if (!!error) {
      rejects(notifyOfForwards(args), error, 'Got expected error');
    } else {
      await notifyOfForwards(args);
    }

    return end();
  });
});
