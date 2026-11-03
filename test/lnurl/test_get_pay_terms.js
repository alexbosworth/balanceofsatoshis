const {createHash} = require('crypto');
const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const method = require('./../../lnurl/get_pay_terms');

const callback = 'https://example.com/callback';
const metadata = '[["text/plain","streaming"]]';
const sha256 = n => createHash('sha256').update(n).digest('hex');
const url = 'https://example.com/.well-known/lnurlp/alice';

// The terms that the service answers with
const makeTerms = overrides => ({
  callback,
  metadata,
  maxSendable: 200000000,
  minSendable: 1000,
  tag: 'payRequest',
  ...overrides,
});

// Make a service that answers with terms, or that cannot be reached
const makeService = ({err, terms}) => ({}, cbk) => {
  // Exit early when the service cannot be reached
  if (!!err) {
    return cbk(err);
  }

  return cbk(null, {}, terms);
};

// Make a service that answers with terms, changed by the overrides of terms
const answering = terms => makeService({terms: makeTerms(terms)});

// Make arguments to get the terms of a service that answers with terms
const makeArgs = overrides => {
  const args = {url, request: answering({})};

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

// Make the expected result for the terms that the service answers with
const makeExpected = overrides => {
  const expected = {
    description: 'streaming',
    hash: sha256(Buffer.from(metadata, 'utf8')),
    max: 200000,
    min: 1,
    url: callback,
  };

  Object.keys(overrides).forEach(k => expected[k] = overrides[k]);

  return expected;
};

// Metadata with an entry that is not an array and an image before the text
const mixed = '["note",["image/png;base64","AA"],["text/plain","streaming"]]';

// Metadata that identifies alice but that has no text/plain entry
const withoutText = '[["text/identifier","alice@example.com"]]';

const tests = [
  {
    args: makeArgs({request: undefined}),
    description: 'A request function is required',
    error: [400, 'ExpectedRequestFunctionToGetPayTerms'],
  },
  {
    args: makeArgs({url: undefined}),
    description: 'A URL is required',
    error: [400, 'ExpectedUrlToGetPayTerms'],
  },
  {
    args: makeArgs({request: makeService({err: 'err'})}),
    description: 'A service that cannot be reached is an error',
    error: [503, 'FailureGettingLnUrlDataFromUrl', {err: 'err'}],
  },
  {
    args: makeArgs({request: makeService({})}),
    description: 'A service has to answer with JSON',
    error: [503, 'ExpectedJsonObjectReturnedInLnurlResponse'],
  },
  {
    args: makeArgs({request: answering({callback: undefined})}),
    description: 'A callback is required',
    error: [503, 'ExpectedCallbackInLnurlResponseJson'],
  },
  {
    args: makeArgs({request: answering({callback: 'callback'})}),
    description: 'A callback has to be a URL',
    error: [503, 'ExpectedValidCallbackUrlInLnurlResponseJson'],
  },
  {
    args: makeArgs({
      request: answering({callback: 'http://example.com/callback'}),
    }),
    description: 'A callback has to be a https URL',
    error: [400, 'LnurlsThatSpecifyNonSslUrlsAreUnsupported'],
  },
  {
    args: makeArgs({request: answering({maxSendable: 'maxSendable'})}),
    description: 'A max sendable has to be a number',
    error: [503, 'ExpectedNumericValueForMaxSendable'],
  },
  {
    args: makeArgs({request: answering({maxSendable: 0})}),
    description: 'A max sendable cannot be zero',
    error: [503, 'ExpectedNonZeroMaxSendableInLnurlResponse'],
  },
  {
    args: makeArgs({request: answering({maxSendable: 999})}),
    description: 'A max sendable has to be at least one token',
    error: [400, 'MaxSendableValueIsLowerThanSupportedValue'],
  },
  {
    args: makeArgs({request: answering({metadata: undefined})}),
    description: 'Metadata is required',
    error: [503, 'ExpectedLnUrlMetadataInLnurlResponse'],
  },
  {
    args: makeArgs({request: answering({metadata: 'metadata'})}),
    description: 'Metadata has to be JSON',
    error: [503, 'ExpectedValidMetadataInLnurlResponse'],
  },
  {
    args: makeArgs({request: answering({metadata: '{}'})}),
    description: 'Metadata has to be an array',
    error: [503, 'ExpectedMetadataArrayInLnurlResponse', makeTerms({
      metadata: '{}',
    })],
  },
  {
    args: makeArgs({request: answering({metadata: withoutText})}),
    description: 'Metadata without a text/plain entry is an error',
    error: [503, 'ExpectedTextPlainEntryInLnurlResponse'],
  },
  {
    args: makeArgs({request: answering({metadata: '[["text/plain",""]]'})}),
    description: 'Metadata with an empty text/plain entry is an error',
    error: [503, 'ExpectedTextPlainEntryInLnurlResponse'],
  },
  {
    args: makeArgs({request: answering({minSendable: 'minSendable'})}),
    description: 'A min sendable has to be a number',
    error: [503, 'ExpectedNumericValueForMinSendable'],
  },
  {
    args: makeArgs({request: answering({minSendable: 0})}),
    description: 'A min sendable has to be positive',
    error: [503, 'ExpectedHigherMinSendableValueInLnurlResponse'],
  },
  {
    args: makeArgs({request: answering({minSendable: 300000000})}),
    description: 'A min sendable cannot be more than the max sendable',
    error: [503, 'ExpectedMaxSendableMoreThanMinSendable'],
  },
  {
    args: makeArgs({request: answering({tag: 'withdrawRequest'})}),
    description: 'The service has to take payments',
    error: [503, 'ExpectedPaymentRequestTagInLnurlResponse'],
  },
  {
    args: makeArgs({request: answering({metadata: mixed, minSendable: 1})}),
    description: 'Terms are returned with the text/plain description',
    expected: makeExpected({hash: sha256(Buffer.from(mixed, 'utf8'))}),
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(method(args), error, 'Got expected error');
    } else {
      deepEqual(await method(args), expected, 'Got expected terms');
    }

    return;
  });
});
