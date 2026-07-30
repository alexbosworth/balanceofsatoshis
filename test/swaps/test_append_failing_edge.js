const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const appendFailingEdge = require('./../../swaps/append_failing_edge.js');

const makeFailure = override => {
  const failure = {
    index: 1,
    reason: 'TemporaryChannelFailure',
    route: {
      hops: [
        {
          channel: '1x1x1',
          public_key: '02',
        },
        {
          channel: '2x2x2',
          public_key: '03',
        },
      ],
    },
  };

  Object.keys(override).forEach(key => failure[key] = override[key]);

  return failure;
};

const makeFs = ({err} = {}) => {
  const fs = {
    calls: [],
    appendFile: (path, content, cbk) => {
      fs.calls.push({content, path});

      return cbk(err);
    },
  };

  return fs;
};

const makeArgs = override => {
  const args = {
    avoid: [
      'AND(',
      'FAILURE_INDEX = 1,',
      'FAILURE_REASON = "TemporaryChannelFailure",',
      'ROUTE_HOPS_COUNT = 2',
      ')',
    ].join(''),
    failure: makeFailure({}),
    fs: makeFs({}),
    list: '/tmp/avoid',
  };

  Object.keys(override).forEach(key => args[key] = override[key]);

  return args;
};

const tests = [
  {
    args: makeArgs({avoid: undefined}),
    description: 'An avoidance formula is required',
    error: [400, 'ExpectedAvoidanceFormulaToAppendFailingEdge'],
  },
  {
    args: makeArgs({failure: undefined}),
    description: 'Failure details are required',
    error: [400, 'ExpectedFailureDetailsToAppendFailingEdge'],
  },
  {
    args: makeArgs({fs: undefined}),
    description: 'Filesystem methods are required',
    error: [400, 'ExpectedFilesystemMethodsToAppendFailingEdge'],
  },
  {
    args: makeArgs({list: undefined}),
    description: 'An avoid list path is required',
    error: [400, 'ExpectedPathToAvoidListToAppendFailingEdge'],
  },
  {
    args: makeArgs({avoid: '('}),
    description: 'A valid avoidance formula is required',
    error: [400, 'ExpectedValidAppendEdgeFormula'],
  },
  {
    appended: [],
    args: makeArgs({avoid: 'FALSE'}),
    description: 'An edge is not appended when the formula does not match',
    expected: {},
  },
  {
    appended: [
      {
        content: '\n2x2x2x0',
        path: '/tmp/avoid',
      },
    ],
    args: makeArgs({}),
    description: 'A failing edge is appended',
    expected: {edge: '2x2x2x0'},
  },
  {
    args: makeArgs({
      fs: makeFs({err: new Error('Failed to append')}),
    }),
    description: 'An append error is returned',
    error: [500, 'UnexpectedErrorAppendingFailEdge'],
  },
];

tests.forEach(({appended, args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(appendFailingEdge(args), error, 'Got expected error');
    } else {
      const result = await appendFailingEdge(args);

      deepEqual(result, expected, 'Got expected result');
      deepEqual(args.fs.calls, appended, 'Got expected appended data');
    }

    return;
  });
});