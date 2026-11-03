const {bech32} = require('bech32');
const {deepEqual} = require('node:assert').strict;
const test = require('node:test');
const {throws} = require('node:assert').strict;

const parseUrl = require('./../../lnurl/parse_url');

const bech32CharLimit = 2000;
const {canParse} = URL;
const serviceUrl = 'https://example.com/lnurl';
const unparseableDomain = 'unparseable.example';
const wordsFor = url => bech32.toWords(Buffer.from(url, 'utf8'));

// Node.js versions differ on which domains make a valid URL, so URL parsing
// is stood in for with one that never takes the unparseable domain
const standInCanParse = n => !n.includes(unparseableDomain) && canParse(n);

const lnurl = bech32.encode('lnurl', wordsFor(serviceUrl), bech32CharLimit);
const notLnurl = bech32.encode('lnbc', wordsFor(serviceUrl), bech32CharLimit);
const notUrl = bech32.encode('lnurl', wordsFor('not a url'), bech32CharLimit);

// Make arguments to parse the lightning address of alice
const makeArgs = overrides => {
  const args = {url: 'alice@example.com'};

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

// Make the expected result, the URL to get the pay terms of alice
const makeExpected = overrides => {
  const expected = {url: 'https://example.com/.well-known/lnurlp/alice'};

  Object.keys(overrides).forEach(k => expected[k] = overrides[k]);

  return expected;
};

const tests = [
  {
    args: makeArgs({url: undefined}),
    description: 'A lnurl or lightning address is required',
    error: 'ExpectedLnurlOrLightningAddressToParse',
  },
  {
    args: makeArgs({}),
    description: 'A lightning address is parsed',
    expected: makeExpected({}),
  },
  {
    args: makeArgs({url: 'alice-bob_1.2@example.com'}),
    description: 'A lightning address username can have dashes',
    expected: makeExpected({
      url: 'https://example.com/.well-known/lnurlp/alice-bob_1.2',
    }),
  },
  {
    args: makeArgs({url: 'alice@wallet.money'}),
    description: 'A lightning address can have a long top level domain',
    expected: makeExpected({
      url: 'https://wallet.money/.well-known/lnurlp/alice',
    }),
  },
  {
    args: makeArgs({url: 'Alice@example.com'}),
    description: 'A lightning address username is lowercase',
    error: 'ExpectedValidUsernameInLightningAddress',
  },
  {
    args: makeArgs({url: 'alice@example.onion'}),
    description: 'A lightning address at an onion domain is not supported',
    error: 'LnurlOnionUrlsCurrentlyUnsupported',
  },
  {
    args: makeArgs({url: `alice@${unparseableDomain}`}),
    description: 'A lightning address has to make a valid URL',
    error: 'ExpectedValidUrlForLightningAddress',
  },
  {
    args: makeArgs({url: lnurl}),
    description: 'A lnurl is parsed',
    expected: makeExpected({url: serviceUrl}),
  },
  {
    args: makeArgs({url: `lightning:${lnurl}`}),
    description: 'A lnurl with a lightning prefix is parsed',
    expected: makeExpected({url: serviceUrl}),
  },
  {
    args: makeArgs({url: notLnurl}),
    description: 'A lnurl has to have the lnurl prefix',
    error: 'ExpectedLnurlPrefix',
  },
  {
    args: makeArgs({url: notUrl}),
    description: 'A lnurl has to hold a valid URL',
    error: 'ExpectedValidUrlInLnurl',
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, ({mock}) => {
    mock.method(URL, 'canParse', standInCanParse);

    if (!!error) {
      throws(() => parseUrl(args), new Error(error), 'Got expected error');
    } else {
      deepEqual(parseUrl(args), expected, 'Got expected result');
    }

    return;
  });
});
