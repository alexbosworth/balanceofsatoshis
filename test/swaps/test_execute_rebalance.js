const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {chanNumber} = require('bolt07');

const {chanInfoResponse} = require('./../fixtures');
const executeRebalance = require('./../../swaps/execute_rebalance');
const {getInfoResponse} = require('./../fixtures');

const avoidListPath = '/tmp/avoids';
const missingChannel = chanNumber({channel: '1x1x1'}).number;
const nodeKey = Buffer.alloc(33, 3).toString('hex');
const tempAvoidListPath = `/tmp/avoids.${process.pid}`;

// A stub filesystem that serves the avoid list and records writes
const makeFs = ({lines}) => {
  const writes = [];

  return {
    writes,
    getFile: (path, cbk) => {
      if (path !== avoidListPath) {
        return cbk(new Error('NoFile'));
      }

      return cbk(null, Buffer.from(lines.join('\n')));
    },
    renameFile: (from, to, cbk) => {
      writes.push({from, to});

      return cbk();
    },
    writeFile: (path, contents, cbk) => {
      writes.push({path, contents});

      return cbk();
    },
  };
};

// A stub LND where channel 1x1x1 is missing from the graph
const makeLnd = ({is_synced}) => {
  return {
    default: {
      getChanInfo: ({chan_id}, cbk) => {
        if (chan_id === missingChannel) {
          return cbk({details: 'edge not found'});
        }

        return cbk(null, chanInfoResponse);
      },
      getInfo: ({}, cbk) => {
        return cbk(null, {...getInfoResponse, synced_to_graph: is_synced});
      },
    },
  };
};

// A logger that keeps a record of everything logged, in order
const makeLogger = () => {
  const logs = [];

  return {
    logs,
    error: error => logs.push({error}),
    info: info => logs.push({info}),
  };
};

const makeArgs = override => {
  const args = {
    fs: makeFs({lines: []}),
    lnd: makeLnd({is_synced: true}),
    logger: makeLogger(),
  };

  Object.keys(override).forEach(key => args[key] = override[key]);

  return args;
};

const tests = [
  {
    args: makeArgs({avoid_append: 'FAILURE_INDEX = 1'}),
    description: 'An avoid list is required to append avoids',
    error: [400, 'ExpectedAvoidListToAppendAvoidsTo'],
  },
  {
    args: makeArgs({fs: undefined}),
    description: 'Filesystem methods are required',
    error: [400, 'ExpectedFsToExecuteRebalance'],
  },
  {
    args: makeArgs({logger: undefined}),
    description: 'A logger is required',
    error: [400, 'ExpectedLoggerToExecuteRebalance'],
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is required',
    error: [400, 'ExpectedAuthenticatedLndToExecuteRebalance'],
  },
  {
    args: makeArgs({in_through: ['a', 'b']}),
    description: 'A rebalance error is returned',
    error: [400, 'MultipleInPeersIsNotSupported'],
    logs: [],
    writes: [],
  },
  {
    args: makeArgs({
      avoid_list: avoidListPath,
      fs: makeFs({lines: ['1x1x1x0', '1x1x1x1', '2x2x2x1', nodeKey]}),
      in_through: ['a', 'b'],
    }),
    description: 'The avoid list is cleaned even when the rebalance fails',
    error: [400, 'MultipleInPeersIsNotSupported'],
    logs: [{info: {deleting_missing_channel: '1x1x1'}}],
    writes: [
      {path: tempAvoidListPath, contents: ['2x2x2x1', nodeKey].join('\n')},
      {from: tempAvoidListPath, to: avoidListPath},
    ],
  },
  {
    args: makeArgs({
      avoid_list: avoidListPath,
      fs: makeFs({lines: ['1x1x1x0', nodeKey]}),
      in_through: ['a', 'b'],
      lnd: makeLnd({is_synced: false}),
    }),
    description: 'The avoid list is left alone when the graph is not synced',
    error: [400, 'MultipleInPeersIsNotSupported'],
    logs: [],
    writes: [],
  },
];

tests.forEach(({args, description, error, expected, logs, writes}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(executeRebalance(args), error, 'Got expected error');
    } else {
      deepEqual(await executeRebalance(args), expected, 'Got expected result');
    }

    if (!!logs) {
      deepEqual(args.logger.logs, logs, 'Got expected logs');
    }

    if (!!writes) {
      deepEqual(args.fs.writes, writes, 'Got expected avoid list writes');
    }

    return;
  });
});
