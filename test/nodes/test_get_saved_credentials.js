const {test} = require('tap');

const {getSavedCredentials} = require('./../../nodes');

const tests = [
  {
    args: {},
    description: 'Getting saved credentials requires fs',
    error: [400, 'ExpectedFileGetMethodToGetSavedCredentials'],
  },
  {
    args: {fs: {}},
    description: 'Getting saved credentials requires fs getFile method',
    error: [400, 'ExpectedFileGetMethodToGetSavedCredentials'],
  },
  {
    args: {fs: {getFile: () => {}}},
    description: 'Getting saved credentials requires node name',
    error: [400, 'ExpectedNodeNameToGetSavedCredentials'],
  },
  {
    args: {fs: {getFile: ({}, cbk) => cbk('err')}, node: 'node'},
    description: 'Error getting credentials still returns node name',
    expected: {node: 'node'},
  },
  {
    args: {fs: {getFile: ({}, cbk) => cbk()}, node: 'node'},
    description: 'No credentials still returns node name',
    expected: {node: 'node'},
  },
  {
    args: {fs: {getFile: ({}, cbk) => cbk(null, 'foo')}, node: 'node'},
    description: 'Invalid saved credentials returns error',
    error: [400, 'SavedNodeHasInvalidCredentials'],
  },
  {
    args: {
      fs: {getFile: ({}, cbk) => cbk(null, JSON.stringify({}))},
      node: 'node',
    },
    description: 'Saved credentials missing cert returns error',
    error: [400, 'SavedNodeMissingCertData'],
  },
  {
    args: {
      fs: {getFile: ({}, cbk) => cbk(null, JSON.stringify({cert: 'cert'}))},
      node: 'node',
    },
    description: 'Saved credentials missing macaroon returns error',
    error: [400, 'SavedNodeMissingMacaroonData'],
  },
  {
    args: {
      fs: {getFile: ({}, cbk) => cbk(null, JSON.stringify({
        cert: 'cert',
        encrypted_macaroon: 'macaroon',
      }))},
      node: 'node',
    },
    description: 'Saved credentials with encrypted mc and no to returns error',
    error: [400, 'MissingEncryptToRecipientsInSavedCredentials'],
  },
  {
    args: {
      fs: {getFile: ({}, cbk) => cbk(null, JSON.stringify({
        cert: 'cert',
        macaroon: 'macaroon',
      }))},
      node: 'node',
    },
    description: 'Saved credentials missing socket returns error',
    error: [400, 'SavedNodeMissingSocket'],
  },
  {
    args: {
      fs: {getFile: ({}, cbk) => cbk(null, JSON.stringify({
        cert: 'cert',
        macaroon: 'macaroon',
        socket: 'socket',
      }))},
      node: 'node',
    },
    description: 'Saved credentials missing socket returns error',
    expected: {
      credentials: {
        cert: 'cert',
        encrypted_macaroon: undefined,
        encrypted_to: undefined,
        macaroon: 'macaroon',
        socket: 'socket',
      },
      node: 'node',
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({deepIs, end, equal, rejects}) => {
    if (!!error) {
      rejects(getSavedCredentials(args), error, 'Got expected error');
    } else {
      const {credentials, node} = await getSavedCredentials(args);

      deepIs(credentials, expected.credentials, 'Got expected credentials');
      equal(node, expected.node, 'Got expected node name');
    }

    return end();
  });
});
