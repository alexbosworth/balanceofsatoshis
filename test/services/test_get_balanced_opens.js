const {deepEqual} = require('node:assert').strict;
const EventEmitter = require('node:events');
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {parsePaymentRequest} = require('ln-service');

const {balancedOpenInvoice} = require('./../fixtures');
const getBalancedOpens = require('./../../services/get_balanced_opens');

const bufferAsHex = buffer => buffer.toString('hex');
const dayMs = 1000 * 60 * 60 * 24;
const epoch = time => Math.floor(time / 1000).toString();
const hourMs = 1000 * 60 * 60;
const now = Date.parse('2026-11-12T18:00:00.000Z');
const request = balancedOpenInvoice.request;

const makePage = overrides => {
  const page = {
    first_index_offset: '1',
    invoices: [{
      ...balancedOpenInvoice.invoice,
      creation_date: epoch(now - hourMs),
      settle_date: epoch(now - hourMs),
    }],
    last_index_offset: '1',
  };

  Object.keys(overrides).forEach(k => page[k] = overrides[k]);

  return page;
};

const makeArgs = overrides => {
  const args = {
    invoice_pages: {0: makePage({})},
    lnd: {
      default: {
        listInvoices: (query, cbk) => {
          args.state.creation_starts.push(query.creation_date_start);
          args.state.offsets.push(query.index_offset);

          return cbk(null, args.invoice_pages[query.index_offset]);
        },
      },
      router: {
        trackPaymentV2: ({}) => {
          const emitter = new EventEmitter();

          emitter.cancel = () => {};

          process.nextTick(() => {
            if (!!args.payment_error) {
              return emitter.emit('error', args.payment_error);
            }

            return emitter.emit('data', {
              payment_hash: bufferAsHex(Buffer.alloc(32)),
              status: 'FAILED',
            });
          });

          return emitter;
        },
      },
    },
    payment_error: undefined,
    state: {creation_starts: [], offsets: []},
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const makeProposal = overrides => {
  const proposal = {
    accept_request: request,
    capacity: 2e6,
    fee_rate: 255,
    partner_public_key: parsePaymentRequest({request}).destination,
    proposed_at: new Date(now - hourMs).toISOString(),
    remote_multisig_key: bufferAsHex(Buffer.alloc(33, 2)),
    remote_tx_id: bufferAsHex(Buffer.alloc(32)),
    remote_tx_vout: 255,
  };

  Object.keys(overrides).forEach(k => proposal[k] = overrides[k]);

  return proposal;
};

const makeExpected = overrides => {
  const expected = {
    creation_starts: [undefined],
    incoming: [makeProposal({})],
    offsets: [0],
  };

  Object.keys(overrides).forEach(k => expected[k] = overrides[k]);

  return expected;
};

const tests = [
  {
    args: makeArgs({}),
    description: 'Get balanced opens',
    expected: makeExpected({}),
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'Authenticated LND is expected',
    error: [400, 'ExpectedAuthenticatedLndToGetBalancedOpens'],
  },
  {
    args: makeArgs({
      invoice_pages: {
        0: makePage({
          first_index_offset: '2',
          invoices: Array.from({length: 100}, (_, i) => ({
            ...balancedOpenInvoice.invoice,
            add_index: (i + 2).toString(),
            creation_date: epoch(now - (i + 2) * 1000),
            htlcs: [],
          })),
          last_index_offset: '101',
        }),
        2: makePage({}),
      },
    }),
    description: 'Find proposals beyond the first invoice page',
    expected: makeExpected({
      creation_starts: [undefined, undefined],
      offsets: [0, 2],
    }),
  },
  {
    args: makeArgs({
      invoice_pages: {
        0: makePage({first_index_offset: '2', last_index_offset: '2'}),
        2: {},
      },
    }),
    description: 'Return errors when a later invoice page cannot be read',
    error: [503, 'ExpectedInvoicesListForInvoicesQuery'],
  },
  {
    args: makeArgs({
      payment_error: {details: 'payment isn\'t initiated'},
    }),
    description: 'An unknown accept payment still offers the proposal',
    expected: makeExpected({}),
  },
  {
    args: makeArgs({
      invoice_pages: {
        0: makePage({
          invoices: [{
            ...balancedOpenInvoice.invoice,
            creation_date: epoch(now - dayMs - 1000),
            settle_date: epoch(now - hourMs),
          }],
        }),
      },
    }),
    description: 'Invoices created over 24 hours ago are not inspected',
    expected: makeExpected({incoming: []}),
  },
  {
    args: makeArgs({
      invoice_pages: {
        0: makePage({
          invoices: [{
            ...balancedOpenInvoice.invoice,
            creation_date: epoch(now - dayMs),
            settle_date: epoch(now - dayMs),
          }],
        }),
      },
    }),
    description: 'Invoices created exactly 24 hours ago are inspected',
    expected: makeExpected({
      incoming: [makeProposal({
        proposed_at: new Date(now - dayMs).toISOString(),
      })],
    }),
  },
  {
    args: makeArgs({
      invoice_pages: {
        0: makePage({
          first_index_offset: '2',
          invoices: [
            {
              ...balancedOpenInvoice.invoice,
              creation_date: epoch(now - hourMs),
              settle_date: epoch(now - hourMs),
            },
            {
              ...balancedOpenInvoice.invoice,
              creation_date: epoch(now - dayMs - 1000),
              htlcs: [],
            },
          ],
        }),
        2: {},
      },
    }),
    description: 'Paging stops at invoices created over 24 hours ago',
    expected: makeExpected({}),
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async t => {
    t.mock.method(Date, 'now', () => now);

    if (!!error) {
      await rejects(getBalancedOpens(args), error, 'Got expected error');
    } else {
      const opens = await getBalancedOpens(args);

      deepEqual({
        ...opens,
        creation_starts: args.state.creation_starts,
        offsets: args.state.offsets,
      }, expected, 'Got expected balanced opens and paging offsets');
    }
  });
});
