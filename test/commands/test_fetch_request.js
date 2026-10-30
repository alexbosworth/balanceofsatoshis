const {deepEqual} = require('node:assert').strict;
const test = require('node:test');

const fetchRequest = require('./../../commands/fetch_request');

// Make a stand-in for fetch that answers with a body or fails
const makeFetch = args => async url => {
  args.urls.push(url);

  // Exit early when the request fails
  if (!!args.err) {
    throw args.err;
  }

  return {
    json: async () => JSON.parse(args.body),
    status: 200,
    text: async () => args.body,
  };
};

// Make a request through a stand-in fetch and collect what it calls back
const makeRequest = ({args, fetch}) => {
  return new Promise(resolve => {
    const calls = [];
    const urls = [];

    const request = fetchRequest({fetch: makeFetch({...fetch, urls})});

    return request(args, (err, res, body) => {
      calls.push({body, err, res});

      return resolve({calls, urls});
    });
  });
};

const tests = [
  {
    args: {json: true, url: 'https://example.com/path'},
    description: 'A JSON response is parsed',
    expected: {
      body: {a: 1},
      res: {statusCode: 200},
      urls: ['https://example.com/path'],
    },
    fetch: {body: '{"a":1}'},
  },
  {
    args: {qs: {limit: 1}, url: 'https://example.com/path'},
    description: 'A text response is returned with query arguments added',
    expected: {
      body: 'text',
      res: {statusCode: 200},
      urls: ['https://example.com/path?limit=1'],
    },
    fetch: {body: 'text'},
  },
  {
    args: {json: true, url: 'https://example.com/path'},
    description: 'A response that is not JSON is an error',
    error: 'SyntaxError',
    fetch: {body: 'text'},
  },
  {
    args: {url: 'https://example.com/path'},
    description: 'A failed request is an error',
    error: 'Error',
    fetch: {err: new Error('fetch failed')},
  },
];

tests.forEach(({args, description, error, expected, fetch}) => {
  return test(description, async () => {
    const {calls, urls} = await makeRequest({args, fetch});

    deepEqual(calls.length, 1, 'Called back once');

    const [{body, err, res}] = calls;

    if (!!error) {
      deepEqual(err.name, error, 'Got expected error');
    } else {
      deepEqual({body, res, urls}, expected, 'Got expected response');
    }

    return;
  });
});
