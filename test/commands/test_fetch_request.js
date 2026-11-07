const {deepEqual} = require('node:assert').strict;
const {setImmediate} = require('node:timers/promises');
const test = require('node:test');

const fetchRequest = require('./../../commands/fetch_request');

const longWait = 1e6;
const okStatus = 200;
const responseBody = 'response';
const url = 'https://example.com/path';

// Make a stand-in for fetch that plays out how a request goes
const makeFetch = args => (url, init) => new Promise((resolve, reject) => {
  args.requests.push({init, url});

  // A request that is stopped fails with the reason it was stopped
  init.signal.addEventListener('abort', () => reject(init.signal.reason));

  // Exit early when the request cannot connect
  if (!!args.is_failing) {
    return reject(new TypeError('fetch failed'));
  }

  // Exit early when the request is never answered
  if (!!args.is_hanging) {
    return;
  }

  const body = args.body || responseBody;

  return resolve({
    json: async () => JSON.parse(body),
    status: args.status || okStatus,
    text: async () => body,
  });
});

// Make a request through a stand-in fetch, and describe what it called back
// and what was fetched once a long wait has passed
const makeRequest = async ({args, fetch, mock}) => {
  const calls = [];
  const requests = [];

  const request = fetchRequest({
    fetch: makeFetch(Object.assign({requests}, fetch)),
  });

  request(args, (err, res, body) => calls.push({body, err, res}));

  // A request that is answered at once is over before the next turn
  await setImmediate();

  // Waiting long enough stops a request that is still going after a timeout
  mock.timers.tick(longWait);

  // Wait to see what else the request calls back
  await setImmediate();

  // A request that never calls back has nothing called back to describe
  const [{body, err, res} = {}] = calls;
  const [fetched] = requests;

  return {
    body,
    res,
    calls: calls.length,
    error: !err ? undefined : err.name,
    is_aborted: fetched.init.signal.aborted,
    sent_body: fetched.init.body,
    sent_method: fetched.init.method,
    url: fetched.url,
  };
};

// Make arguments for a request to the example URL
const makeArgs = overrides => {
  const args = {url};

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

// Make the expected result, a text response to a request of the example URL
const makeExpected = overrides => {
  const expected = {
    url,
    body: responseBody,
    calls: 1,
    error: undefined,
    is_aborted: false,
    res: {statusCode: okStatus},
    sent_body: undefined,
    sent_method: undefined,
  };

  Object.keys(overrides).forEach(k => expected[k] = overrides[k]);

  return expected;
};

const tests = [
  {
    args: makeArgs({}),
    description: 'A response is called back as text with its status',
    expected: makeExpected({}),
    fetch: {},
  },
  {
    args: makeArgs({json: true}),
    description: 'A JSON response is parsed',
    expected: makeExpected({body: {a: 1}}),
    fetch: {body: '{"a":1}'},
  },
  {
    args: makeArgs({json: true}),
    description: 'A response that is not JSON is an error',
    expected: makeExpected({
      body: undefined,
      error: 'SyntaxError',
      res: undefined,
    }),
    fetch: {body: 'text'},
  },
  {
    args: makeArgs({qs: {chat_id: 1, is_preview: true, text: 'a b&c'}}),
    description: 'Query arguments are encoded onto the URL',
    expected: makeExpected({
      url: `${url}?chat_id=1&is_preview=true&text=a%20b%26c`,
    }),
    fetch: {},
  },
  {
    args: makeArgs({body: 'transaction', method: 'POST'}),
    description: 'A body is sent with the method of the request',
    expected: makeExpected({sent_body: 'transaction', sent_method: 'POST'}),
    fetch: {},
  },
  {
    args: makeArgs({}),
    description: 'A response with an error status is called back as usual',
    expected: makeExpected({body: 'rate limited', res: {statusCode: 429}}),
    fetch: {body: 'rate limited', status: 429},
  },
  {
    args: makeArgs({}),
    description: 'A request that cannot connect is an error',
    expected: makeExpected({
      body: undefined,
      error: 'TypeError',
      res: undefined,
    }),
    fetch: {is_failing: true},
  },
  {
    args: makeArgs({timeout: 100}),
    description: 'A request still going after its timeout is stopped',
    expected: makeExpected({
      body: undefined,
      error: 'AbortError',
      is_aborted: true,
      res: undefined,
    }),
    fetch: {is_hanging: true},
  },
  {
    args: makeArgs({timeout: 100}),
    description: 'A request answered within its timeout is not stopped later',
    expected: makeExpected({}),
    fetch: {},
  },
  {
    args: makeArgs({timeout: 100}),
    description: 'A request failing within its timeout is not stopped later',
    expected: makeExpected({
      body: undefined,
      error: 'TypeError',
      res: undefined,
    }),
    fetch: {is_failing: true},
  },
];

tests.forEach(({args, description, expected, fetch}) => {
  return test(description, async ({mock}) => {
    mock.timers.enable({apis: ['setTimeout']});

    deepEqual(await makeRequest({args, fetch, mock}), expected, 'Got result');

    return;
  });
});
