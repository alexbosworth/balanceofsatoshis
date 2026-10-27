const {deepEqual} = require('node:assert').strict;
const EventEmitter = require('node:events');
const https = require('node:https');
const test = require('node:test');

const simpleRequest = require('./../../commands/simple_request');

// Make a stand-in for https.request that plays out how a request goes
const makeRequest = args => {
  return (options, onResponse) => {
    const req = new EventEmitter();

    // Destroying a request that has not been answered makes it error
    req.destroy = () => {
      args.destroyed.push(true);

      return req.emit('error', new Error('socket hang up'));
    };

    req.end = () => {
      // Exit early when the request cannot connect
      if (!!args.is_failing) {
        return req.emit('error', new Error('connect ECONNREFUSED'));
      }

      // Exit early when the request is not answered in time
      if (!!args.is_timing_out) {
        return req.emit('timeout');
      }

      const res = new EventEmitter();

      onResponse(res);

      res.emit('data', Buffer.from(args.body));

      // Exit early when the response is cut off
      if (!!args.is_cut_off) {
        return res.emit('error', new Error('aborted'));
      }

      return res.emit('end');
    };

    return req;
  };
};

const tests = [
  {
    args: {},
    description: 'A URL is required',
    error: [400, 'ExpectedUrlToExecuteSimpleRequest'],
  },
  {
    args: {url: 'http://example.com/'},
    description: 'An HTTPS URL is required',
    error: [400, 'ExpectedHttpsProtocolToExecuteSimpleRequest'],
  },
  {
    args: {url: 'https://example.com/'},
    description: 'A request that cannot connect is an error',
    error: [503, 'UnexpectedErrorExecutingSimpleRequest'],
    request: {is_failing: true},
  },
  {
    args: {timeout: 1, url: 'https://example.com/'},
    description: 'A request that times out is an error once',
    error: [503, 'RequestTimedOut'],
    request: {is_timing_out: true},
  },
  {
    args: {url: 'https://example.com/'},
    description: 'A response that is cut off is an error',
    error: [503, 'UnexpectedErrorReceivingSimpleRequest'],
    request: {body: 'partial', is_cut_off: true},
  },
  {
    args: {json: true, url: 'https://example.com/'},
    description: 'A response that is expected to be JSON has to be JSON',
    error: [503, 'ExpectedJsonResponseToSimpleRequest'],
    request: {body: 'text'},
  },
  {
    args: {
      headers: {'user-agent': 'bos'},
      json: true,
      qs: {limit: 1},
      url: 'https://example.com/path?start=1',
    },
    description: 'A JSON response is parsed',
    expected: {
      body: {a: 1},
      headers: {'user-agent': 'bos'},
      path: '/path?start=1&limit=1',
    },
    request: {body: '{"a":1}'},
  },
  {
    args: {url: 'https://example.com/'},
    description: 'A response is returned as text',
    expected: {body: 'text', path: '/'},
    request: {body: 'text'},
  },
];

tests.forEach(({args, description, error, expected, request}) => {
  return test(description, async ({mock}) => {
    const calls = [];
    const destroyed = [];
    const sent = [];

    mock.method(https, 'request', (options, onResponse) => {
      sent.push(options);

      const play = makeRequest(Object.assign({destroyed}, request));

      return play(options, onResponse);
    });

    simpleRequest(args, (err, res, body) => calls.push({body, err}));

    // The request plays out at once, and it calls back a single time
    deepEqual(calls.length, 1, 'Called back once');

    // Only a request that is not answered in time is stopped
    const isTimeout = !!request && !!request.is_timing_out;

    deepEqual(!!destroyed.length, isTimeout, 'A timed out request is stopped');

    const [{body, err}] = calls;

    if (!!error) {
      deepEqual(err.slice(0, 2), error, 'Got expected error');
    } else {
      const [{headers, path}] = sent;

      deepEqual(body, expected.body, 'Got expected response body');
      deepEqual(headers, expected.headers, 'Request headers are passed');
      deepEqual(path, expected.path, 'Query string arguments are added');
    }

    return;
  });
});
