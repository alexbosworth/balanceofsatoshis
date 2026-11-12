const {deepEqual} = require('node:assert').strict;
const EventEmitter = require('node:events');
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {createPsbt} = require('psbt');

const waitForSwapInPayment = require('./../../swaps/wait_for_swap_in_payment');

const deposits = 'Swap in again with --recovery or refund after expiry';
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const id = '01'.repeat(32);
const metadata = {get: () => []};
const notFinished = 'swap not finished yet';
const otherId = '02'.repeat(32);
const received = 1000;
const timeout = 200;

// A settlement request of the service for the swap utxo
const {psbt} = createPsbt({
  outputs: [{script: `0014${'00'.repeat(20)}`, tokens: 1}],
  utxos: [{id: '03'.repeat(32), vout: 0}],
});

// An invoice as LND returns it, settled when tokens were received
const makeInvoice = ({tokens}) => ({
  amt_paid_msat: String((tokens || 0) * 1e3),
  amt_paid_sat: String(tokens || 0),
  creation_date: '1700000000',
  description_hash: Buffer.alloc(0),
  expiry: '31536000',
  features: {},
  htlcs: [],
  memo: 'memo',
  payment_addr: Buffer.alloc(32),
  payment_request: 'request',
  r_hash: hexAsBuffer(id),
  r_preimage: Buffer.alloc(32),
  state: !!tokens ? 'SETTLED' : 'OPEN',
  value: '1000',
  value_msat: '1000000',
});

// A stream that emits data on the next turn of the event loop
const makeStream = items => {
  const stream = new EventEmitter();

  stream.cancel = () => {};

  setImmediate(() => items.forEach(item => stream.emit('data', item)));

  return stream;
};

// LND at a chain height that sends invoice updates and cancels invoices
const makeLnd = ({cancel, height, invoices, lookup}) => {
  const lnd = {canceled: 0};

  const block = {hash: Buffer.alloc(32), height: height || timeout - 1};

  lnd.chain = {registerBlockEpochNtfn: () => makeStream([block])};

  lnd.default = {lookupInvoice: ({}, cbk) => cbk(null, lookup)};

  lnd.invoices = {
    cancelInvoice: ({}, cbk) => {
      lnd.canceled++;

      return cbk(cancel);
    },
    subscribeSingleInvoice: () => {
      lnd.invoice = makeStream(invoices || [makeInvoice({tokens: received})]);

      return lnd.invoice;
    },
  };

  // The swap gets paid
  lnd.settle = () => lnd.invoice.emit('data', makeInvoice({tokens: received}));

  return lnd;
};

// A swap service that pays the swap when it is told the swap is not finished
const makeService = ({lnd}) => {
  const service = {pushes: []};

  service.pushStaticAddressSweeplessSigs = (request, {}, cbk) => {
    service.pushes.push(request.error_message);

    lnd.settle();

    return cbk();
  };

  return service;
};

const makeArgs = overrides => {
  const lnd = makeLnd(overrides.node || {});

  const args = {
    id,
    lnd,
    metadata,
    timeout,
    logger: {error: () => {}},
    notifications: {accepted: [], rejected: [], sweeps: []},
    payment_timeout_seconds: 60,
    service: makeService({lnd}),
    updates: new EventEmitter(),
  };

  Object.keys(overrides).forEach(key => args[key] = overrides[key]);

  return args;
};

const makeExpected = overrides => {
  const expected = {
    received,
    canceled: 0,
    deferred: 0,
    error: undefined,
    pushes: [],
  };

  Object.keys(overrides).forEach(key => expected[key] = overrides[key]);

  return expected;
};

// What happened while waiting: the outcome and the side effects
const outcome = async args => {
  const canceled = () => args.lnd.canceled;

  try {
    const res = await waitForSwapInPayment(args);

    return {
      canceled: canceled(),
      deferred: res.deferred.length,
      error: undefined,
      pushes: args.service.pushes,
      received: res.received,
    };
  } catch (error) {
    return {
      error,
      canceled: canceled(),
      deferred: undefined,
      pushes: args.service.pushes,
      received: undefined,
    };
  }
};

const tests = [
  {
    args: makeArgs({id: undefined}),
    description: 'A swap hash is expected',
    error: [400, 'ExpectedSwapHashToWaitForSwapInPayment'],
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is expected',
    error: [400, 'ExpectedLndToWaitForSwapInPayment'],
  },
  {
    args: makeArgs({logger: undefined}),
    description: 'A logger is expected',
    error: [400, 'ExpectedLoggerToWaitForSwapInPayment'],
  },
  {
    args: makeArgs({metadata: undefined}),
    description: 'Auth metadata is expected',
    error: [400, 'ExpectedAuthMetadataToWaitForSwapInPayment'],
  },
  {
    args: makeArgs({notifications: undefined}),
    description: 'Notifications are expected',
    error: [400, 'ExpectedNotificationsToWaitForSwapInPayment'],
  },
  {
    args: makeArgs({payment_timeout_seconds: undefined}),
    description: 'A payment timeout is expected',
    error: [400, 'ExpectedPaymentTimeoutToWaitForSwapInPayment'],
  },
  {
    args: makeArgs({service: undefined}),
    description: 'A swap service is expected',
    error: [400, 'ExpectedServiceToWaitForSwapInPayment'],
  },
  {
    args: makeArgs({timeout: undefined}),
    description: 'An HTLC timeout is expected',
    error: [400, 'ExpectedHtlcTimeoutToWaitForSwapInPayment'],
  },
  {
    args: makeArgs({updates: undefined}),
    description: 'Notification updates are expected',
    error: [400, 'ExpectedUpdatesToWaitForSwapInPayment'],
  },
  {
    args: makeArgs({}),
    description: 'A paid swap is paid',
    expected: makeExpected({}),
  },
  {
    args: makeArgs({
      node: {invoices: []},
      notifications: {accepted: [], rejected: [id], sweeps: []},
    }),
    description: 'A rejected swap gets its invoice canceled',
    expected: makeExpected({
      canceled: 1,
      deferred: undefined,
      error: [503, 'SwapServiceRejectedSwapInDeposits', {deposits}],
      received: undefined,
    }),
  },
  {
    args: makeArgs({
      node: {invoices: [makeInvoice({})]},
      notifications: {accepted: [{id, at: 0}], rejected: [], sweeps: []},
    }),
    description: 'A swap not paid in time after acceptance is given up',
    expected: makeExpected({
      canceled: 1,
      deferred: undefined,
      error: [503, 'SwapInPaymentDeadlinePassed', {deposits}],
      received: undefined,
    }),
  },
  {
    args: makeArgs({node: {height: timeout, invoices: []}}),
    description: 'A swap not paid by the HTLC timeout is given up',
    expected: makeExpected({
      canceled: 1,
      deferred: undefined,
      error: [503, 'SwapInHtlcTimedOutWithoutPayment', {deposits}],
      received: undefined,
    }),
  },
  {
    args: makeArgs({
      node: {invoices: []},
      notifications: {accepted: [], rejected: [], sweeps: [{id, psbt}]},
    }),
    description: 'A settlement request before the payment is deferred',
    expected: makeExpected({deferred: 1, pushes: [notFinished]}),
  },
  {
    args: makeArgs({
      notifications: {
        accepted: [],
        rejected: [],
        sweeps: [{psbt, id: otherId}],
      },
    }),
    description: 'A settlement request of another swap is not deferred',
    expected: makeExpected({}),
  },
  {
    args: makeArgs({
      node: {
        cancel: 'err',
        invoices: [],
        lookup: makeInvoice({tokens: received}),
      },
      notifications: {accepted: [], rejected: [id], sweeps: []},
    }),
    description: 'A swap paid while giving up on it is paid',
    expected: makeExpected({canceled: 1}),
  },
  {
    args: makeArgs({
      node: {cancel: 'err', invoices: [], lookup: makeInvoice({})},
      notifications: {accepted: [], rejected: [id], sweeps: []},
    }),
    description: 'Failing to cancel the invoice of an unpaid swap is an error',
    expected: makeExpected({
      canceled: 1,
      deferred: undefined,
      error: [
        503,
        'FailedToCancelUnpaidSwapInInvoice',
        {
          err: [503, 'UnexpectedErrorCancelingHodlInvoice', {err: 'err'}],
          failure: 'SwapServiceRejectedSwapInDeposits',
        },
      ],
      received: undefined,
    }),
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(waitForSwapInPayment(args), error, 'Got expected error');
    } else {
      deepEqual(await outcome(args), expected, 'Got expected outcome');
    }

    return;
  });
});
