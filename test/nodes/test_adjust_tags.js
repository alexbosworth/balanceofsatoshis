const {test} = require('tap');

const adjustTags = require('./../../nodes/adjust_tags');

const makeArgs = overrides => {
  const args = {
    add: [],
    fs: {
      getFile: (path, cbk) => cbk(),
      makeDirectory: (path, cbk) => cbk(),
      writeFile: (path, file, cbk) => cbk(),
    },
    remove: [],
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({add: undefined}),
    description: 'Expected add array',
    error: [400, 'ExpectedArrayOfNodesToAddToTag'],
  },
  {
    args: makeArgs({add: ['test']}),
    description: 'Expected add array with public keys',
    error: [400, 'ExpectedPublicKeyOfNodeToAddToTag'],
  },
  {
    args: makeArgs({fs: undefined}),
    description: 'Expected fs methods',
    error: [400, 'ExpectedFileSystemMethodsToAdjustTags'],
  },
  {
    args: makeArgs({id: 'id'}),
    description: 'Ids are expected to be hashes',
    error: [400, 'ExpectedHashFormatForTagId'],
  },
  {
    args: makeArgs({remove: undefined}),
    description: 'Expected remove array',
    error: [400, 'ExpectedArrayOfNodesToRemoveFromTag'],
  },
  {
    args: makeArgs({remove: ['test']}),
    description: 'Expected remove array with public keys',
    error: [400, 'ExpectedPublicKeyOfNodeToRemoveFromTag'],
  },
  {
    args: makeArgs({}),
    description: 'Fetch the set of tags',
    expected: {tags: []},
  },
  {
    args: makeArgs({
      fs: {
        getFile: (path, cbk) => cbk('err'),
        makeDirectory: (path, cbk) => cbk('err'),
        writeFile: (path, file, cbk) => cbk(),
      },
    }),
    description: 'Errors in filesystem calls are ignored',
    expected: {tags: []},
  },
  {
    args: makeArgs({
      fs: {
        getFile: (path, cbk) => cbk(null, Buffer.from('invalid-json')),
        makeDirectory: (path, cbk) => cbk('err'),
        writeFile: (path, file, cbk) => cbk(),
      },
    }),
    description: 'The tags file must be valid json',
    error: [400, 'ExpectedValidJsonTagsFileToAdjustTags'],
  },
  {
    args: makeArgs({
      fs: {
        getFile: (path, cbk) => cbk(null, JSON.stringify({
          tags: [{id: Buffer.alloc(32).toString('hex')}],
        })),
        makeDirectory: (path, cbk) => cbk(),
        writeFile: (path, file, cbk) => cbk(),
      },
    }),
    description: 'Tags are returned',
    expected: {
      tags: [{
        id: '0000000000000000000000000000000000000000000000000000000000000000',
      }],
    },
  },
  {
    args: makeArgs({
      add: [Buffer.alloc(33, 2).toString('hex')],
      fs: {
        getFile: (path, cbk) => cbk(null, JSON.stringify({
          tags: [{id: Buffer.alloc(32).toString('hex')}],
        })),
        makeDirectory: (path, cbk) => cbk(),
        writeFile: (path, file, cbk) => cbk(),
      },
      icon: '+',
      is_avoided: true,
      tag: '0000000000000000000000000000000000000000000000000000000000000000',
    }),
    description: 'A node is added to a tag and set to avoid, with an icon',
    expected: {
      tag: {
        icon: '+',
        id: '0000000000000000000000000000000000000000000000000000000000000000',
        is_avoided: true,
        nodes: [Buffer.alloc(33, 2).toString('hex')],
      },
    },
  },
  {
    args: makeArgs({
      add: [Buffer.alloc(33, 2).toString('hex')],
      fs: {
        getFile: (path, cbk) => cbk(null, JSON.stringify({
          tags: [{id: Buffer.alloc(32).toString('hex')}],
        })),
        makeDirectory: (path, cbk) => cbk(),
        writeFile: (path, file, cbk) => cbk('err'),
      },
      tag: '0000000000000000000000000000000000000000000000000000000000000000',
    }),
    description: 'Writing errors are returned',
    error: [503, 'UnexpectedErrorSavingTagFileUpdate', {err: 'err'}],
  },
  {
    args: makeArgs({
      fs: {
        getFile: (path, cbk) => cbk(null, JSON.stringify({
          tags: [{
            id: Buffer.alloc(32).toString('hex'),
            nodes: [Buffer.alloc(33, 2).toString('hex')],
          }],
        })),
        makeDirectory: (path, cbk) => cbk(),
        writeFile: (path, file, cbk) => cbk(),
      },
      remove: [Buffer.alloc(33, 2).toString('hex')],
      tag: '0000000000000000000000000000000000000000000000000000000000000000',
    }),
    description: 'A node is removed from a tag',
    expected: {
      tag: {
        id: '0000000000000000000000000000000000000000000000000000000000000000',
        nodes: [],
      },
    },
  },
  {
    args: makeArgs({
      fs: {
        getFile: (path, cbk) => cbk(null, JSON.stringify({
          tags: [{
            id: Buffer.alloc(32).toString('hex'),
            nodes: [Buffer.alloc(33, 2).toString('hex')],
          }],
        })),
        makeDirectory: (path, cbk) => cbk(),
        writeFile: (path, file, cbk) => cbk(),
      },
      tag: '0000000000000000000000000000000000000000000000000000000000000000',
    }),
    description: 'A single tag is returned',
    expected: {
      tag: {
        id: '0000000000000000000000000000000000000000000000000000000000000000',
        nodes: [
          '020202020202020202020202020202020202020202020202020202020202020202',
        ],
      },
    },
  },
  {
    args: makeArgs({
      add: [Buffer.alloc(33, 2).toString('hex')],
      fs: {
        getFile: (path, cbk) => cbk(null, JSON.stringify({tags: []})),
        makeDirectory: (path, cbk) => cbk(),
        writeFile: (path, file, cbk) => cbk(),
      },
      id: Buffer.alloc(32).toString('hex'),
      tag: 'alias',
    }),
    description: 'A tag is created',
    expected: {
      tag: {
        alias: 'alias',
        id: '0000000000000000000000000000000000000000000000000000000000000000',
        nodes: [
          '020202020202020202020202020202020202020202020202020202020202020202',
        ],
      },
    },
  },
  {
    args: makeArgs({
      fs: {
        getFile: (path, cbk) => cbk(null, JSON.stringify({tags: []})),
        makeDirectory: (path, cbk) => cbk(),
        writeFile: (path, file, cbk) => cbk(),
      },
      remove: [Buffer.alloc(33, 2).toString('hex')],
      tag: '0000000000000000000000000000000000000000000000000000000000000000',
    }),
    description: 'Nodes cannot be removed from non-existing tags',
    error: [400, 'FailedToFindTheTagToRemoveFrom'],
  },
  {
    args: makeArgs({
      fs: {
        getFile: (path, cbk) => cbk(null, JSON.stringify({
          tags: [
            {
              alias: 'alias1',
              id: Buffer.alloc(32).toString('hex'),
              nodes: [Buffer.alloc(33, 2).toString('hex')],
            },
            {
              alias: 'alias2',
              id: Buffer.alloc(32, 1).toString('hex'),
              nodes: [Buffer.alloc(33, 2).toString('hex')],
            },
          ],
        })),
        makeDirectory: (path, cbk) => cbk(),
        writeFile: (path, file, cbk) => cbk(),
      },
      remove: [Buffer.alloc(33, 2).toString('hex')],
      tag: 'alias',
    }),
    description: 'Tag references must be unambiguous',
    error: [400, 'AmbiguousTagToAdjustSpecified'],
  },
  {
    args: makeArgs({
      fs: {
        getFile: (path, cbk) => cbk(null, JSON.stringify({})),
        makeDirectory: (path, cbk) => cbk(),
        writeFile: (path, file, cbk) => cbk(),
      },
    }),
    description: 'Tags array is expected',
    error: [400, 'ExpectedTagsArrayInTagsFileToAdjustTags'],
  },
  {
    args: makeArgs({
      fs: {
        getFile: (path, cbk) => cbk(null, JSON.stringify({tags: [{}]})),
        makeDirectory: (path, cbk) => cbk(),
        writeFile: (path, file, cbk) => cbk(),
      },
    }),
    description: 'Tags are expected to have ids',
    error: [400, 'ExpectedIdForTagToAdjustTags'],
  },
  {
    args: makeArgs({
      fs: {
        getFile: (path, cbk) => cbk(null, JSON.stringify({tags: [{
          alias: 1,
          id: Buffer.alloc(32).toString('hex'),
        }]})),
        makeDirectory: (path, cbk) => cbk(),
        writeFile: (path, file, cbk) => cbk(),
      },
    }),
    description: 'Aliases are expected to be strings',
    error: [400, 'ExpectedAliasStringToAdjustTags'],
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({deepIs, end, equal, rejects}) => {
    if (!!error) {
      await rejects(adjustTags(args), error, 'Got expected error');
    } else {
      const res = await adjustTags(args);

      deepIs(res, expected, 'Got expected result');
    }

    return end();
  });
});
