const {equal} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {getMempoolSize} = require('./../../chain');

const tests = [
  {
    args: {},
    description: 'Network name is required',
    error: [400, 'ExpectedNetworkNameToGetMempoolSize'],
  },
  {
    args: {network: 'btc'},
    description: 'Request function is required',
    error: [400, 'ExpectedRequestMethodToGetMempoolSize'],
  },
  {
    args: {network: 'btc', request: ({}, cbk) => cbk('err'), retries: 1},
    description: 'Request errors are passed back',
    error: [503, 'FailedToGetMempoolSizeInfo', {err: 'err'}],
  },
  {
    args: {network: 'btc', request: ({}, cbk) => cbk(), retries: 1},
    description: 'Mempool information is expected',
    error: [503, 'ExpectedMempoolInfoInResponse'],
  },
  {
    args: {
      network: 'btc',
      request: ({}, cbk) => cbk(null, null, {}),
      retries: 1,
    },
    description: 'Mempool response vbytes are expected',
    error: [503, 'ExpectedMempoolVirtualByteSize'],
  },
  {
    args: {
      network: 'btctestnet',
      request: ({}, cbk) => cbk(null, null, {vsize: 1}),
      retries: 1,
    },
    description: 'VBytes are returned',
    expected: {vbytes: 1},
  },
  {
    args: {
      network: 'network',
      request: ({}, cbk) => cbk(),
      retries: 1,
    },
    description: 'No vbytes are returned',
    expected: {},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(getMempoolSize(args), error, 'Got expected error');
    } else {
      const {vbytes} = await getMempoolSize(args);

      equal(vbytes, expected.vbytes, 'Got expected vbytes');
    }

    return;
  });
});
