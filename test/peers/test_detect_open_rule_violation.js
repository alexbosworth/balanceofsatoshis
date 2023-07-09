const {equal} = require('node:assert').strict;
const EventEmitter = require('node:events');
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {chanInfoResponse} = require('./../fixtures');
const detect = require('./../../peers/detect_open_rule_violation');
const {getNodeInfoResponse} = require('./../fixtures');
const {versionInfoResponse} = require('./../fixtures');

const makeArgs = overrides => {
  const args = {
    capacity: 1,
    id: Buffer.alloc(33, 2),
    lnd: {
      chain: {
        registerBlockEpochNtfn: ({}) => {
          const emitter = new EventEmitter();

          emitter.cancel = () => {};

          process.nextTick(() => emitter.emit('data', {
            hash: Buffer.alloc(32),
            height: 10,
          }));

          return emitter;
        },
      },
      default: {
        getChanInfo: (args, cbk) => cbk(null, chanInfoResponse),
        getNodeInfo: ({}, cbk) => cbk(null, getNodeInfoResponse),
      },
      version: {
        getVersion: ({}, cbk) => cbk(null, versionInfoResponse),
      },
    },
    local_balance: 1,
    partner_public_key: Buffer.alloc(33, 2).toString('hex'),
    rules: ['capacity > 0'],
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({capacity: undefined}),
    description: 'Capacity is required',
    error: [400, 'ExpectedChannelCapacityToDetectRuleViolation'],
  },
  {
    args: makeArgs({}),
    description: 'No rule violation is detected',
    expected: {},
  },
  {
    args: makeArgs({rules: ['capacity > 0', 'capacity > 1']}),
    description: 'A rule violation is detected',
    expected: {rule: 'capacity > 1'},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(detect(args), error, 'Got expected error');
    } else {
      const {rule} = await detect(args);

      equal(rule, expected.rule, 'Got expected rule violation');
    }

    return;
  });
});
