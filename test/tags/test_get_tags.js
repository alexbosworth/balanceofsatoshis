const {test} = require('@alexbosworth/tap');

const method = require('./../../tags/get_tags');

const makeArgs = overrides => {
  const args = {
    fs: {
      getFile: ({}, cbk) => {
        const tags = [{
          alias: 'alias',
          id: Buffer.alloc(32).toString('hex'),
          nodes: [Buffer.alloc(33, 2).toString('hex')],
        }];

        return cbk(null, Buffer.from(JSON.stringify({tags})));
      },
    },
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({}),
    description: 'Get tags',
    expected: {
      tags: [{
        alias: 'alias',
        id: '0000000000000000000000000000000000000000000000000000000000000000',
        nodes: [
          '020202020202020202020202020202020202020202020202020202020202020202',
        ],
      }],
    },
  },
  {
    args: makeArgs({fs: {getFile: ({}, cbk) => cbk('err')}}),
    description: 'Get file has an error',
    expected: {tags: []},
  },
  {
    args: makeArgs({fs: {getFile: ({}, cbk) => cbk()}}),
    description: 'Get file returns nothing',
    expected: {tags: []},
  },
  {
    args: makeArgs({
      fs: {getFile: ({}, cbk) => cbk(null, Buffer.from('invalid_json'))},
    }),
    description: 'Get file returns invalid JSON',
    expected: {tags: []},
  },
  {
    args: makeArgs({
      fs: {
        getFile: ({}, cbk) => {
          return cbk(null, Buffer.from(JSON.stringify({tags: 'tags'})));
        },
      },
    }),
    description: 'Get file returns invalid tags',
    expected: {tags: []},
  },
  {
    args: makeArgs({
      fs: {
        getFile: ({}, cbk) => {
          return cbk(null, Buffer.from(JSON.stringify({tags: [null]})));
        },
      },
    }),
    description: 'Get file returns invalid tag data',
    expected: {tags: []},
  },
  {
    args: makeArgs({fs: undefined}),
    description: 'Fs is required',
    error: [400, 'ExpectedFileSystemMethodsToGetTags'],
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects, strictSame}) => {
    if (!!error) {
      await rejects(method(args, args.test), error, 'Got error');
    } else {
      const res = await method(args);

      strictSame(res, expected, 'Got expected res');
    }

    return end();
  });
});
