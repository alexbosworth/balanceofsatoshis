const {equal} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {encodeAsCbor} = require('./../../encryption');
const {getInfoResponse} = require('./../fixtures');
const getPaidService = require('./../../swaps/get_paid_service');

const macaroon = 'AgEEbHNhdAJCAADXNkGQ+faRDM3Ey4M6YGALyTwqnLqDTNVgCBckgnpSZ4vd9z8+Ndr1+zLD6i/AmJIbDVuEAvBwgZBezq2hcys5AAIPc2VydmljZXM9bG9vcDowAAISbG9vcF9jYXBhYmlsaXRpZXM9AAAGIDPTqKe/hckryPR6hINTa7Dg8/bbxqVqq02/eBMpmt7Z';
const preimage = Buffer.alloc(1, 1);

// A token encodes the macaroon and then the preimage
const token = encodeAsCbor({
  value: {macaroon: Buffer.from(macaroon, 'base64'), preimage},
})
.cbor;

const makeArgs = override => {
  const args = {
    fetch,
    token,
    lnd: {
      default: {
        getInfo: ({}, cbk) => cbk(null, getInfoResponse),
      },
    },
  };

  Object.keys(override).forEach(key => args[key] = override[key]);

  return args;
};

const tests = [
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND object is required',
    error: [400, 'ExpectedLndToGetPaidService'],
  },
  {
    args: makeArgs({}),
    description: 'A paid service object is returned',
    expected: {
      token,
      metadata: {get: () => [Buffer.alloc(1, 1).toString('hex')]},
      service: {},
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(getPaidService(args), error, 'Got expected error');
    } else {
      const paid = await getPaidService(args);

      equal(paid.macaroon, expected.macaroon, 'Got expected macaroon');
      equal(paid.paid, expected.paid, 'Got expected paid tokens');
      equal(paid.preimage, expected.preimage, 'Got expected preimage');
      equal(paid.token, expected.token, 'Got expected token');
    }

    return;
  });
});
