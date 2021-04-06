const {test} = require('tap');

const {getSavedNodes} = require('./../../nodes');

const getDirectoryFiles = ({}, cbk) => cbk(null, ['name']);

const tests = [
  {
    args: {},
    description: 'Getting saved nodes requires fs',
    error: [400, 'ExpectedFileSystemMethods'],
  },
  {
    args: {fs: {}},
    description: 'Filesystem methods requires a directory files function',
    error: [400, 'ExpectedGetDirectoryFilesMethod'],
  },
  {
    args: {fs: {getDirectoryFiles: () => {}}},
    description: 'Filesystem methods requires a get file function',
    error: [400, 'ExpectedReadFileFunction'],
  },
  {
    args: {fs: {getDirectoryFiles: ({}, cbk) => {}, getFile: ({}, cbk) => {}}},
    description: 'Filesystem methods requires a read file function',
    error: [400, 'ExpectedReadFileStatusFunction'],
  },
  {
    args: {
      fs: {
        getDirectoryFiles: ({}, cbk) => {},
        getFile: ({}, cbk) => {},
        getFileStatus: ({}, cbk) => cbk('err'),
      },
    },
    description: 'Error getting data dir returns back error',
    error: [503, 'UnexpectedErrCheckingForDataDirectory', {err: 'err'}],
  },
  {
    args: {
      fs: {
        getDirectoryFiles: ({}, cbk) => {},
        getFile: ({}, cbk) => {},
        getFileStatus: ({}, cbk) => cbk(null, {isDirectory: () => false}),
      },
    },
    description: 'The home directory must be a directory',
    error: [400, 'FailedToFindHomeDataDirectory'],
  },
  {
    args: {
      fs: {
        getDirectoryFiles: ({}, cbk) => cbk(null, []),
        getFile: ({}, cbk) => cbk(),
        getFileStatus: ({}, cbk) => cbk(null, {isDirectory: () => true}),
      },
    },
    description: 'A directory with no saved nodes returns an empty array',
    expected: {nodes: []},
  },
  {
    args: {
      fs: {
        getDirectoryFiles,
        getFile: ({}, cbk) => cbk(),
        getFileStatus: (path, cbk) => {
          if (path.slice(-'name'.length) === 'name') {
            return cbk('err');
          }

          return cbk(null, {isDirectory: () => true});
        },
      },
    },
    description: 'Errors when getting node dir are passed back',
    error: [503, 'UnexpectedErrCheckingForNodeDir', {err: 'err'}],
  },
  {
    args: {
      fs: {
        getDirectoryFiles,
        getFile: ({}, cbk) => cbk(null, 'foo'),
        getFileStatus: (path, cbk) => {
          return cbk(null, {isDirectory: () => true});
        },
      },
    },
    description: 'The saved node has to have JSON credentials',
    error: [400, 'SavedNodeHasInvalidCredentials'],
  },
  {
    args: {
      fs: {
        getDirectoryFiles,
        getFile: ({}, cbk) => cbk(null, JSON.stringify({cert: 'cert'})),
        getFileStatus: (path, cbk) => {
          return cbk(null, {isDirectory: () => true});
        },
      },
    },
    description: 'The saved node has to have JSON credentials',
    error: [400, 'SavedNodeMissingMacaroonData'],
  },
  {
    args: {
      fs: {
        getDirectoryFiles,
        getFile: ({}, cbk) => cbk(null, JSON.stringify({
          cert: 'cert',
          macaroon: 'macaroon',
        })),
        getFileStatus: (path, cbk) => {
          return cbk(null, {isDirectory: () => true});
        },
      },
    },
    description: 'The saved node has to have JSON credentials',
    error: [400, 'SavedNodeMissingSocket'],
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects, strictSame}) => {
    if (!!error) {
      rejects(getSavedNodes(args), error, 'Got expected error');
    } else {
      const {nodes} = await getSavedNodes(args);

      strictSame(nodes, expected.nodes, 'Got expected nodes');
    }

    return end();
  });
});
