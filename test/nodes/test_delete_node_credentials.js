const {test} = require('tap');

const deleteNodeCredentials = require('./../../nodes/delete_node_credentials');

const tests = [
  {
    args: {},
    description: 'Deleting a saved credential requires fs',
    error: [400, 'ExpectedFsMethodsToDeleteNodeCredentials'],
  },
  {
    args: {fs: {}},
    description: 'Deleting a saved credential requires a node name',
    error: [400, 'ExpectedNodeNameToDeleteNodeCredentials'],
  },
  {
    args: {fs: {removeFile: ({}, cbk) => cbk('err')}, node: 'node'},
    description: 'Error deleting a file is returned',
    error: [503, 'FailedToRemoveCredentialsFile', {err: 'err'}],
  },
  {
    args: {
      fs: {
        removeDirectory: ({}, cbk) => cbk('err'),
        removeFile: ({}, cbk) => cbk(),
      },
      node: 'node',
    },
    description: 'Error deleting a folder is returned',
    error: [503, 'FailedToRemoveCredentialsDirectory', {err: 'err'}],
  },
  {
    args: {
      fs: {
        removeDirectory: ({}, cbk) => cbk(),
        removeFile: ({}, cbk) => cbk(),
      },
      node: 'node',
    },
    description: 'A node can be successfully deleted',
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects, strictSame}) => {
    if (!!error) {
      rejects(deleteNodeCredentials(args), error, 'Got expected error');
    } else {
      await deleteNodeCredentials(args);
    }

    return end();
  });
});
