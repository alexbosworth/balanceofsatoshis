const {deepEqual} = require('node:assert').strict;
const EventEmitter = require('node:events');
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const method = require('./../../network/get_pending_paths');

const id = Buffer.alloc(32).toString('hex');
const peer = Buffer.alloc(33, 1).toString('hex');
const timeoutMs = 1000;

const makePayment = overrides => {
  const payment = {
    creation_date: '1',
    creation_time_ns: '1000000000',
    fee_msat: '1000',
    fee_sat: '1',
    htlcs: [{
      attempt_id: '1',
      attempt_time_ns: '1000000000',
      resolve_time_ns: '0',
      route: {
        hops: [{
          amt_to_forward_msat: '100000',
          chan_id: '1',
          custom_records: {},
          expiry: 500,
          fee_msat: '0',
          pub_key: peer,
          tlv_payload: true,
        }],
        total_amt_msat: '100000',
        total_fees_msat: '0',
        total_time_lock: 500,
      },
      status: 'IN_FLIGHT',
    }],
    payment_hash: id,
    payment_index: '1',
    payment_preimage: Buffer.alloc(32).toString('hex'),
    payment_request: '',
    status: 'IN_FLIGHT',
    value_msat: '100000',
    value_sat: '100',
  };

  Object.keys(overrides).forEach(k => payment[k] = overrides[k]);

  return payment;
};

// The LND tracks a payment with an event stream that can be canceled
const makeLnd = ({data, err, is_silent}) => {
  const canceled = [];

  return {
    canceled,
    router: {
      trackPaymentV2: ({}) => {
        const emitter = new EventEmitter();

        emitter.cancel = () => canceled.push(true);

        process.nextTick(() => {
          // Exit early when the stream has nothing to emit
          if (!!is_silent) {
            return;
          }

          if (!!err) {
            return emitter.emit('error', err);
          }

          if (!data) {
            return emitter.emit('end');
          }

          return emitter.emit('data', data);
        });

        return emitter;
      },
    },
  };
};

const tests = [
  {
    args: {},
    description: 'A payment hash is required to get pending paths',
    error: [400, 'ExpectedPaymentHashToGetPendingPaths'],
  },
  {
    args: {id},
    description: 'LND is required to get pending paths',
    error: [400, 'ExpectedAuthenticatedLndToGetPendingPaths'],
  },
  {
    args: {id, lnd: makeLnd({})},
    description: 'A timeout is required to get pending paths',
    error: [400, 'ExpectedTimeoutMillisecondsToGetPendingPaths'],
  },
  {
    args: {
      id,
      lnd: makeLnd({err: {details: 'unknown'}}),
      timeout_ms: timeoutMs,
    },
    description: 'Unexpected errors are passed back',
    error: [503, 'UnexpectedGetPaymentError', {err: {details: 'unknown'}}],
  },
  {
    args: {
      id,
      lnd: makeLnd({err: {details: `payment isn't initiated`}}),
      timeout_ms: timeoutMs,
    },
    description: 'A payment that is not known has no pending paths',
    expected: {id, paths: []},
  },
  {
    args: {id, lnd: makeLnd({}), timeout_ms: timeoutMs},
    description: 'A payment stream that ends has no pending paths',
    expected: {id, paths: []},
  },
  {
    args: {id, lnd: makeLnd({is_silent: true}), timeout_ms: [id].length},
    description: 'A payment with nothing to report is given up on',
    expected: {id, paths: []},
  },
  {
    args: {id, lnd: makeLnd({data: makePayment({})}), timeout_ms: timeoutMs},
    description: 'The pending paths of an in-flight payment are returned',
    expected: {
      id,
      created_at: '1970-01-01T00:00:01.000Z',
      paths: [{
        fee: 0,
        fee_mtokens: '0',
        hops: [{
          channel: '0x0x1',
          fee: 0,
          fee_mtokens: '0',
          forward: 100,
          forward_mtokens: '100000',
          public_key: peer,
          timeout: 500,
        }],
        mtokens: '100000',
        payment: undefined,
        timeout: 500,
        tokens: 100,
        total_mtokens: undefined,
      }],
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(method(args), error, 'Got expected error');
    } else {
      deepEqual(await method(args), expected, 'Got expected pending paths');
    }

    // A finished lookup cancels its subscription
    if (!!args.timeout_ms) {
      deepEqual(!!args.lnd.canceled.length, true, 'Subscription canceled');
    }

    return;
  });
});
