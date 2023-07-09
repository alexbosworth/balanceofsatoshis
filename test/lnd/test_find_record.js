const {deepEqual} = require('node:assert').strict;
const EventEmitter = require('node:events');
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {describeGraphResponse} = require('./../fixtures');
const {findRecord} = require('./../../lnd');

const tests = [
  {
    args: {},
    description: 'Finding a record requires LND',
    error: [400, 'ExpectedLndObjectToFindRecord'],
  },
  {
    args: {lnd: {}},
    description: 'Finding a record requires a query string',
    error: [400, 'QueryExpectedToFindRecord'],
  },
  {
    args: {
      lnd: {
        chain: {
          registerBlockEpochNtfn: ({}) => {
            const emitter = new EventEmitter();

            emitter.cancel = () => {};

            process.nextTick(() => emitter.emit('data', {
              hash: Buffer.alloc(32),
              height: 1,
            }));

            return emitter;
          },
        },
        default: {
          closedChannels: ({}, cbk) => cbk(null, {channels: []}),
          describeGraph: ({}, cbk) => cbk(null, describeGraphResponse),
          listChannels: ({}, cbk) => cbk(null, {channels: []}),
        },
      },
      query: 'a',
    },
    description: 'Can find a graph node',
    expected: {
      chain_transaction: undefined,
      channels: undefined,
      nodes: [{
        alias: 'alias',
        capacity: '0.00000001',
        is_accepting_large_channels: undefined,
        public_key: 'a',
        urls: ['a@127.0.0.1:9735'],
        past_channels: [],
        connected_channels: [],
      }],
      payment: undefined,
      payment_failed: undefined,
      payment_pending: undefined,
    },
  },
  {
    args: {
      lnd: {
        chain: {
          registerBlockEpochNtfn: ({}) => {
            const emitter = new EventEmitter();

            emitter.cancel = () => {};

            process.nextTick(() => emitter.emit('data', {
              hash: Buffer.alloc(32),
              height: 1,
            }));

            return emitter;
          },
        },
        default: {
          closedChannels: ({}, cbk) => cbk(null, {channels: []}),
          describeGraph: ({}, cbk) => cbk(null, describeGraphResponse),
          listChannels: ({}, cbk) => cbk(null, {channels: []}),
        },
      },
      query: '0x0x1',
    },
    description: 'Can find a graph channel',
    expected: {
      chain_transaction: undefined,
      channels: [{
        capacity: 1,
        id: '0x0x1',
        policies: [
          {
            alias: 'alias',
            base_fee_mtokens: undefined,
            cltv_delta: undefined,
            fee_rate: undefined,
            is_disabled: undefined,
            max_htlc_mtokens: undefined,
            min_htlc_mtokens: undefined,
            public_key: 'a',
          },
          {
            alias: 'b',
            base_fee_mtokens: undefined,
            cltv_delta: undefined,
            fee_rate: undefined,
            is_disabled: undefined,
            max_htlc_mtokens: undefined,
            min_htlc_mtokens: undefined,
            public_key: 'b',
          },
        ],
        transaction_id: '0',
        transaction_vout: 0,
        updated_at: undefined,
      }],
      nodes: undefined,
      payment: undefined,
      payment_failed: undefined,
      payment_pending: undefined,
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(findRecord(args), error, 'Got expected error');
    } else {
      const res = await findRecord(args);

      (res.nodes || []).forEach(n => delete n.updated);

      deepEqual(res, expected, 'Got expected result');
    }

    return;
  });
});
