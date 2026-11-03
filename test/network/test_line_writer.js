const {deepEqual} = require('node:assert').strict;
const test = require('node:test');

const method = require('./../../network/line_writer');

// Lines that fail to be made, that are made later, or that are made now
const failing = err => () => Promise.reject(err);
const later = line => () => new Promise(done => setImmediate(done, line));
const now = line => () => Promise.resolve(line);

// Make arguments for a writer with lines to write, the lines written are noted
const makeArgs = overrides => {
  const noted = {logs: []};

  const args = {
    noted,
    lines: [],
    logger: {
      error: line => noted.logs.push({error: line}),
      info: line => noted.logs.push({info: line}),
    },
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

// Make the expected lines written, by default nothing is written
const makeExpected = overrides => {
  const expected = {logs: []};

  Object.keys(overrides).forEach(k => expected[k] = overrides[k]);

  return expected;
};

const tests = [
  {
    args: makeArgs({}),
    description: 'Waiting for no lines is done right away',
    expected: makeExpected({}),
  },
  {
    args: makeArgs({lines: [later({first: 1}), now({second: 2})]}),
    description: 'Lines are written in the order they are started',
    expected: makeExpected({logs: [{info: {first: 1}}, {info: {second: 2}}]}),
  },
  {
    args: makeArgs({
      lines: [later({first: 1}), failing('err'), now({third: 3})],
    }),
    description: 'A line that fails to be made is written as an error',
    expected: makeExpected({
      logs: [
        {info: {first: 1}},
        {error: {err: 'err'}},
        {info: {third: 3}},
      ],
    }),
  },
];

tests.forEach(({args, description, expected}) => {
  return test(description, async () => {
    const writer = method(args);

    args.lines.forEach(make => writer.write(make()));

    await writer.wait();

    deepEqual(args.noted, expected, 'Got expected lines');

    return;
  });
});
