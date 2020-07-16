const {test} = require('@alexbosworth/tap');

const sendMessage = require('./../../telegram/send_message');

const tests = [
  {
    args: {},
    description: 'Send message requires a user id',
    error: [400, 'ExpectedChatIdToSendMessageToTelegram'],
  },
  {
    args: {id: 1},
    description: 'Send message requires an api key',
    error: [400, 'ExpectedApiKeyToSendMessageToTelegram'],
  },
  {
    args: {id: 1, key: 'key'},
    description: 'Send message requires a request method',
    error: [400, 'ExpectedRequestFunctionToSendMessageToTelegram'],
  },
  {
    args: {id: 1, key: 'key', request: () => {}},
    description: 'Send message requires text to send',
    error: [400, 'ExpectedTextOfMessageToSendToTelegram'],
  },
  {
    args: {id: 1, key: 'key', request: ({}, cbk) => cbk('err'), text: 'text'},
    description: 'Send message request errors are passed back',
    error: [503, 'FailedToConnectToTelegramToSendMessage', {err: 'err'}],
  },
  {
    args: {id: 1, key: 'key', request: ({}, cbk) => cbk(), text: 'text'},
    description: 'Send message empty response results in error',
    error: [503, 'ExpectedResponseFromTelegramSendMessage'],
  },
  {
    args: {
      id: 1,
      key: 'key',
      request: ({qs}, cbk) => {
        if (!qs.parse_mode) {
          return cbk('err')
        } else {
          return cbk(null, {statusCode: 400});
        }
      },
      text: 'text',
    },
    description: 'Send message empty response results in error',
    error: [503, 'FailedToConnectToTelegramApiToSend', {err: 'err'}],
  },
  {
    args: {
      id: 1,
      key: 'key',
      request: ({qs}, cbk) => {
        if (!qs.parse_mode) {
          return cbk()
        } else {
          return cbk(null, {statusCode: 400});
        }
      },
      text: 'text',
    },
    description: 'Send message empty response results in error',
    error: [503, 'ExpectedResponseFromTelegramSend'],
  },
  {
    args: {
      id: 1,
      key: 'key',
      request: ({}, cbk) => cbk(null, {statusCode: 400}),
      text: 'text',
    },
    description: 'Send message empty response results in error',
    error: [503, 'UnexpectedStatusCodeFromTelegram'],
  },
  {
    args: {
      id: 1,
      key: 'key',
      request: ({}, cbk) => cbk(null, {statusCode: 200}),
      text: 'text',
    },
    description: 'Send message success',
  },
  {
    args: {
      id: 1,
      key: 'key',
      request: ({qs}, cbk) => {
        if (!!qs.parse_mode) {
          return cbk(null, {statusCode: 400});
        } else {
          return cbk(null, {statusCode: 200});
        }
      },
      text: 'text',
    },
    description: 'Send message failure on parse mode results in retry',
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects}) => {
    if (!!error) {
      rejects(sendMessage(args), error, 'Got expected error');
    } else {
      await sendMessage(args);
    }

    return end();
  });
});
