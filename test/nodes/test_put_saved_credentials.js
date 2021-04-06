const {test} = require('tap');

const putSavedCredentials = require('./../../nodes/put_saved_credentials');

const tests = [
  {
    args: {encrypted_macaroon: 'macaroon'},
    description: 'Passing an encrypted macaroon requires encrypted to array',
    error: [400, 'ExpectedRecipientIdsForEncryptedMacaroon'],
  },
  {
    args: {encrypted_macaroon: 'macaroon', encrypted_to: [], macaroon: 'm'},
    description: 'Cannot pass both a macaroon and encrypted macaroon',
    error: [400, 'UnexpectedUnencryptedMacaroon'],
  },
  {
    args: {},
    description: 'Either a macaroon or an encrypted macaroon is required',
    error: [400, 'ExpectedMacaroonForSavedCredentials'],
  },
  {
    args: {macaroon: 'macaroon'},
    description: 'File system methods are required',
    error: [400, 'ExpectedFileSystemMethodsToPutSavedCredentials'],
  },
  {
    args: {fs: {}, macaroon: 'macaroon'},
    description: 'File system methods are required',
    error: [400, 'ExpectedFileSystemMethodsToPutSavedCredentials'],
  },
  {
    args: {fs: {writeFile: () => {}}, macaroon: 'macaroon'},
    description: 'A node name is required',
    error: [400, 'ExpectedNodeNameToPutSavedCredentials'],
  },
  {
    args: {fs: {writeFile: () => {}}, macaroon: 'macaroon', node: 'node'},
    description: 'A socket is required',
    error: [400, 'ExpectedSocketForNodeToPutSavedCredentials'],
  },
  {
    args: {
      fs: {
        makeDirectory: (path, cbk) => cbk(),
        writeFile: (path, file, cbk) => cbk('err'),
      },
      macaroon: 'macaroon',
      node: 'node',
      socket: 'socket',
    },
    description: 'Errors writing file are passed back',
    error: [503, 'UnexpectedErrorWritingSavedCredentials', {err: 'err'}],
  },
  {
    args: {
      fs: {
        makeDirectory: (path, cbk) => cbk(),
        writeFile: (path, file, cbk) => cbk(),
      },
      encrypted_macaroon: 'encrypted_macaroon',
      encrypted_to: [],
      node: 'node',
      socket: 'socket',
    },
    description: 'Errors writing file are passed back',
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects, strictSame}) => {
    if (!!error) {
      rejects(putSavedCredentials(args), error, 'Got expected error');
    } else {
      await putSavedCredentials(args);
    }

    return end();
  });
});
