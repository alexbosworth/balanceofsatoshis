const {encode} = require('cbor');
const {test} = require('tap');

const registerNode = require('./../../nodes/register_node');

const tests = [
  {
    args: {},
    description: 'Expected ask function',
    error: [400, 'ExpectedAskFunctionToRegisterSavedNode'],
  },
  {
    args: {ask: () => {}},
    description: 'Expected cryptography methods',
    error: [400, 'ExpectedCryptographyFunctionsToRegisterNode'],
  },
  {
    args: {ask: () => {}, cryptography: {}},
    description: 'Expected file system methods',
    error: [400, 'ExpectedFileSystemMethodsToRegisterSavedNode'],
  },
  {
    args: {ask: () => {}, cryptography: {}, fs: {}},
    description: 'Expected logger',
    error: [400, 'ExpectedLoggerToRegisterSavedNode'],
  },
  {
    args: {
      ask: ({}, cbk) => cbk({}),
      cryptography: {},
      fs: {makeDirectory: (path, cbk) => cbk()},
      logger: {},
    },
    description: 'Start acknowledgement is required',
    error: [400, 'CanceledNodeRegistration'],
  },
  {
    args: {
      ask: ({}, cbk) => cbk({start: true}),
      cryptography: {generateKeyPair: ({}, {}, cbk) => cbk('err')},
      fs: {makeDirectory: (path, cbk) => cbk()},
      logger: {},
    },
    description: 'Key generation errors are passed back',
    error: [503, 'FailedToGenerateCredentialsKey', {err: 'err'}],
  },
  {
    args: {
      ask: ({}, cbk) => cbk({start: true}),
      cryptography: {generateKeyPair: ({}, {}, cbk) => cbk(null, '1', '2')},
      fs: {makeDirectory: (path, cbk) => cbk()},
      logger: {info: () => {}},
    },
    description: 'Copy acknowledgement is required',
    error: [400, 'CanceledNodeRegistration'],
  },
  {
    args: {
      ask: ({}, cbk) => cbk({copied: true, start: true}),
      cryptography: {generateKeyPair: ({}, {}, cbk) => cbk(null, '1', '2')},
      fs: {makeDirectory: (path, cbk) => cbk()},
      logger: {info: () => {}},
    },
    description: 'Credentials entry is required',
    error: [400, 'ExpectedCredentialsForRemoteNode'],
  },
  {
    args: {
      ask: ({}, cbk) => cbk({
        copied: true,
        credentials: '888888888888888888888888',
        start: true,
      }),
      cryptography: {generateKeyPair: ({}, {}, cbk) => cbk(null, '1', '2')},
      fs: {makeDirectory: (path, cbk) => cbk()},
      logger: {info: () => {}},
    },
    description: 'Valid CBOR encoding required',
    error: [400, 'ExpectedValidEncodedCredentials'],
  },
  {
    args: {
      ask: ({}, cbk) => cbk({
        copied: true,
        credentials: encode({}),
        start: true,
      }),
      cryptography: {generateKeyPair: ({}, {}, cbk) => cbk(null, '1', '2')},
      fs: {makeDirectory: (path, cbk) => cbk()},
      logger: {info: () => {}},
    },
    description: 'Credentials requires TLS cert',
    error: [400, 'ExpectedTlsCertInCredentials'],
  },
  {
    args: {
      ask: ({}, cbk) => cbk({
        copied: true,
        credentials: encode({cert: 'cert'}),
        start: true,
      }),
      cryptography: {generateKeyPair: ({}, {}, cbk) => cbk(null, '1', '2')},
      fs: {makeDirectory: (path, cbk) => cbk()},
      logger: {info: () => {}},
    },
    description: 'Encrypted macaroon required',
    error: [400, 'ExpectedEncryptedMacaroonInCredentials'],
  },
  {
    args: {
      ask: ({}, cbk) => cbk({
        copied: true,
        credentials: encode({
          cert: 'cert',
          encrypted_macaroon: 'macaroon',
          socket: '::::::::',
        }),
        start: true,
      }),
      cryptography: {generateKeyPair: ({}, {}, cbk) => cbk(null, '1', '2')},
      fs: {makeDirectory: (path, cbk) => cbk()},
      logger: {info: () => {}},
    },
    description: 'Standard socket type required',
    error: [400, 'ExpectedStandardSocketInCredentials'],
  },
  {
    args: {
      ask: ({}, cbk) => cbk({
        copied: true,
        credentials: encode({
          cert: 'cert',
          encrypted_macaroon: 'macaroon',
          socket: 'localhost:10009',
        }),
        start: true,
      }),
      cryptography: {
        generateKeyPair: ({}, {}, cbk) => cbk(null, '1', '2'),
        privateDecrypt: ({}, {}) => {
          throw new Error('err');
        },
      },
      fs: {makeDirectory: (path, cbk) => cbk()},
      logger: {info: () => {}},
    },
    description: 'Valid encrypted macaroon required',
    error: [400, 'FailedToDecryptNodeMacaroon'],
  },
  {
    args: {
      ask: ({}, cbk) => cbk({
        copied: true,
        credentials: encode({
          cert: 'cert',
          encrypted_macaroon: 'macaroon',
        }),
        start: true,
      }),
      cryptography: {
        generateKeyPair: ({}, {}, cbk) => cbk(null, '1', '2'),
        privateDecrypt: ({}, {}) => 'macaroon',
      },
      fs: {makeDirectory: (path, cbk) => cbk()},
      logger: {info: () => {}},
    },
    description: 'Valid host required',
    error: [400, 'ExpectedHostForNodeCredentials'],
  },
  {
    args: {
      ask: ({}, cbk) => cbk({
        copied: true,
        credentials: encode({
          cert: 'cert',
          encrypted_macaroon: 'macaroon',
        }),
        host: 'localhost',
        start: true,
      }),
      cryptography: {
        generateKeyPair: ({}, {}, cbk) => cbk(null, '1', '2'),
        privateDecrypt: ({}, {}) => 'macaroon',
      },
      fs: {makeDirectory: (path, cbk) => cbk()},
      logger: {info: () => {}},
    },
    description: 'Valid port required',
    error: [400, 'ExpectedPortForNodeCredentials'],
  },
  {
    args: {
      ask: ({}, cbk) => cbk({
        copied: true,
        credentials: encode({
          cert: 'cert',
          encrypted_macaroon: 'macaroon',
        }),
        host: 'localhost',
        port: 10009,
        start: true,
      }),
      cryptography: {
        generateKeyPair: ({}, {}, cbk) => cbk(null, '1', '2'),
        privateDecrypt: ({}, {}) => 'macaroon',
      },
      fs: {makeDirectory: (path, cbk) => cbk()},
      logger: {info: () => {}},
    },
    description: 'Node registration confirmation required',
    error: [400, 'CanceledNodeRegistration'],
  },
  {
    args: {
      ask: ({}, cbk) => cbk({
        copied: true,
        credentials: encode({
          cert: 'cert',
          encrypted_macaroon: 'macaroon',
        }),
        host: 'host',
        moniker: 'moniker',
        port: 10009,
        start: true,
      }),
      cryptography: {
        generateKeyPair: ({}, {}, cbk) => cbk(null, '1', '2'),
        privateDecrypt: ({}, {}) => 'macaroon',
      },
      fs: {
        makeDirectory: (path, cbk) => cbk(),
        writeFile: (path, file, cbk) => cbk(),
      },
      logger: {info: () => {}},
    },
    description: 'Node registration ok',
  },
  {
    args: {
      ask: ({}, cbk) => cbk({
        copied: true,
        credentials: encode({
          cert: 'cert',
          encrypted_macaroon: 'macaroon',
        }),
        host: 'host',
        moniker: 'moniker',
        port: 10009,
        start: true,
      }),
      cryptography: {
        generateKeyPair: ({}, {}, cbk) => cbk(null, '1', '2'),
        privateDecrypt: ({}, {}) => 'macaroon',
      },
      fs: {
        makeDirectory: (path, cbk) => cbk(),
        writeFile: (path, file, cbk) => cbk(),
      },
      logger: {info: () => {}},
      node: 'node',
    },
    description: 'Node registration ok when node name is specified',
  },
  {
    args: {
      ask: ({}, cbk) => cbk({
        copied: true,
        credentials: encode({
          cert: 'cert',
          encrypted_macaroon: 'macaroon',
          socket: 'localhost',
        }),
        host: 'host',
        moniker: 'moniker',
        port: 10009,
        start: true,
      }),
      cryptography: {
        generateKeyPair: ({}, {}, cbk) => cbk(null, '1', '2'),
        privateDecrypt: ({}, {}) => 'macaroon',
      },
      fs: {
        makeDirectory: (path, cbk) => cbk(),
        writeFile: (path, file, cbk) => cbk(),
      },
      logger: {info: () => {}},
      node: 'node',
    },
    description: 'When no port is specified, default port is used',
  },
  {
    args: {
      ask: ({}, cbk) => cbk({
        copied: true,
        credentials: encode({
          cert: 'cert',
          encrypted_macaroon: 'macaroon',
        }),
        host: 'host',
        moniker: '/////.....///::://',
        port: 10009,
        start: true,
      }),
      cryptography: {
        generateKeyPair: ({}, {}, cbk) => cbk(null, '1', '2'),
        privateDecrypt: ({}, {}) => 'macaroon',
      },
      fs: {
        makeDirectory: (path, cbk) => cbk(),
        writeFile: (path, file, cbk) => cbk(),
      },
      logger: {info: () => {}},
    },
    description: 'Valid directory name required for node',
    error: [400, 'InvalidNameForNode'],
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects, strictSame}) => {
    if (!!error) {
      rejects(registerNode(args), error, 'Got expected error');
    } else {
      await registerNode(args);
    }

    return end();
  });
});
