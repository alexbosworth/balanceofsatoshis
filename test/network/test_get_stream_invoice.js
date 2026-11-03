const {createHash} = require('crypto');
const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {createSignedRequest} = require('ln-service');
const {createUnsignedRequest} = require('ln-service');
const {pointFromScalar} = require('tiny-secp256k1');
const {sign} = require('tiny-secp256k1');

const method = require('./../../network/get_stream_invoice');

const bufferAsHex = buffer => Buffer.from(buffer).toString('hex');
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const key = Buffer.alloc(32, 1);
const metadata = '[["text/plain","streaming"]]';
const sha256 = n => createHash('sha256').update(n).digest('hex');

const hash = sha256(Buffer.from(metadata, 'utf8'));

// Make a payment request from the service for 150k
const makeRequest = ({}) => {
  const destination = bufferAsHex(pointFromScalar(key, true));

  const unsigned = createUnsignedRequest({
    destination,
    cltv_delta: 40,
    description_hash: hash,
    expires_at: '2100-01-01T00:00:00.000Z',
    id: bufferAsHex(Buffer.alloc(32, 1)),
    mtokens: '150000000',
    network: 'bitcoin',
    payment: bufferAsHex(Buffer.alloc(32, 3)),
  });

  return createSignedRequest({
    destination,
    hrp: unsigned.hrp,
    signature: bufferAsHex(sign(hexAsBuffer(unsigned.hash), key)),
    tags: unsigned.tags,
  }).request;
};

const request = makeRequest({});

// Make a service that makes the invoice, declines, or cannot be reached
const makeService = ({err, reason}) => ({}, cbk) => {
  // Exit early when the service cannot be reached
  if (!!err) {
    return cbk(err);
  }

  // Exit early when the service declines to make the invoice
  if (!!reason) {
    return cbk(null, {}, {reason, status: 'ERROR'});
  }

  return cbk(null, {}, {pr: request});
};

// Make arguments to get an invoice for 150k, the lines logged are noted
const makeArgs = overrides => {
  const noted = {logs: []};

  const args = {
    hash,
    noted,
    logger: {info: line => noted.logs.push(line)},
    mtokens: '150000000',
    request: makeService({}),
    url: 'https://example.com/callback',
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

// Make the expected result and lines logged, by default nothing is logged
const makeExpected = overrides => {
  const expected = {logs: []};

  Object.keys(overrides).forEach(k => expected[k] = overrides[k]);

  return expected;
};

const tests = [
  {
    args: makeArgs({hash: undefined}),
    description: 'A description hash is required',
    error: [400, 'ExpectedDescriptionHashToGetStreamInvoice'],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({logger: undefined}),
    description: 'A logger is required',
    error: [400, 'ExpectedLoggerToGetStreamInvoice'],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({mtokens: undefined}),
    description: 'An amount is required',
    error: [400, 'ExpectedMillitokensToGetStreamInvoice'],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({request: undefined}),
    description: 'A request function is required',
    error: [400, 'ExpectedRequestFunctionToGetStreamInvoice'],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({url: undefined}),
    description: 'A service URL is required',
    error: [400, 'ExpectedServiceUrlToGetStreamInvoice'],
    expected: makeExpected({}),
  },
  {
    args: makeArgs({}),
    description: 'An invoice is requested from the service',
    expected: makeExpected({
      request,
      logs: [{requesting_invoice: '0.00150000'}, {payment_request: request}],
    }),
  },
  {
    args: makeArgs({request: makeService({reason: 'amount too large'})}),
    description: 'A service that declines the amount turns it down',
    expected: makeExpected({
      is_amount_too_high: true,
      logs: [
        {requesting_invoice: '0.00150000'},
        {invoice_declined: '0.00150000', reason: 'amount too large'},
      ],
    }),
  },
  {
    args: makeArgs({request: makeService({err: 'err'})}),
    description: 'A service that cannot be reached is an error',
    error: [503, 'FailedToGetPaymentRequestFromService', {err: 'err'}],
    expected: makeExpected({logs: [{requesting_invoice: '0.00150000'}]}),
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(method(args), error, 'Got expected error');
    } else {
      // The result is compared together with the lines that were logged
      Object.assign(args.noted, await method(args));
    }

    deepEqual(args.noted, expected, 'Got expected result');

    return;
  });
});
