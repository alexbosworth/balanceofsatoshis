const {deepEqual} = require('node:assert').strict;
const EventEmitter = require('node:events');
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {balancedOpenInvoice} = require('./../fixtures');
const {getInfoResponse} = require('./../fixtures');
const openBalancedChannel = require('./../../services/open_balanced_channel');

const bufferAsHex = buffer => buffer.toString('hex');
const epoch = date => (Date.parse(date) / 1000).toString();
const keyResponse = () => ({
  key_loc: {key_index: 0},
  raw_key_bytes: Buffer.alloc(33, 2),
});
const now = Date.parse('2026-11-12T18:00:00.000Z');

const makeArgs = overrides => {
  const args = {
    after: '2026-11-12T12:00:00.000Z',
    ask: ({name}, cbk) => {
      args.state.prompts.push(name);

      // Decline the proposal and cancel initiation with an empty peer key
      return cbk({accept: false, key: ''});
    },
    lnd: {
      default: {
        getInfo: ({}, cbk) => cbk(null, getInfoResponse),
        listInvoices: ({}, cbk) => {
          return cbk(null, {
            first_index_offset: '1',
            invoices: [{
              ...balancedOpenInvoice.invoice,
              creation_date: epoch('2026-11-12T11:59:58.000Z'),
              settle_date: epoch(args.settled_at),
            }],
            last_index_offset: '1',
          });
        },
      },
      router: {
        trackPaymentV2: ({}) => {
          const emitter = new EventEmitter();

          emitter.cancel = () => {};

          process.nextTick(() => emitter.emit('data', {
            payment_hash: bufferAsHex(Buffer.alloc(32)),
            status: 'FAILED',
          }));

          return emitter;
        },
      },
      wallet: {
        deriveKey: ({}, cbk) => cbk(null, keyResponse()),
        deriveNextKey: ({}, cbk) => cbk(null, keyResponse()),
      },
    },
    logger: {info: () => {}},
    settled_at: '2026-11-12T12:00:01.000Z',
    state: {prompts: []},
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const makeExpected = overrides => {
  const expected = {
    error: [400, 'ExpectedPartnerPublicKeyToInitBalancedChannel'],
    prompts: ['accept', 'key'],
  };

  Object.keys(overrides).forEach(k => expected[k] = overrides[k]);

  return expected;
};

const tests = [
  {
    args: makeArgs({settled_at: '2026-11-12T11:59:59.000Z'}),
    description: 'A proposal settled before the cutoff is skipped',
    expected: makeExpected({prompts: ['key']}),
  },
  {
    args: makeArgs({settled_at: '2026-11-12T12:00:00.000Z'}),
    description: 'A proposal settled at the cutoff is offered',
    expected: makeExpected({}),
  },
  {
    args: makeArgs({}),
    description: 'A proposal created before and settled after is offered',
    expected: makeExpected({}),
  },
];

tests.forEach(({args, description, expected}) => {
  return test(description, async t => {
    t.mock.method(Date, 'now', () => now);

    await rejects(openBalancedChannel(args), expected.error, 'Canceled');

    deepEqual(args.state.prompts, expected.prompts, 'Got expected prompts');
  });
});
