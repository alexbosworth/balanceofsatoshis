const {encode} = require('cbor');
const fetch = require('node-fetch');
const {test} = require('tap');

const {getInfoResponse} = require('./../fixtures');
const getPaidService = require('./../../swaps/get_paid_service');

const macaroon = 'AgEEbHNhdAJCAADXNkGQ+faRDM3Ey4M6YGALyTwqnLqDTNVgCBckgnpSZ4vd9z8+Ndr1+zLD6i/AmJIbDVuEAvBwgZBezq2hcys5AAIPc2VydmljZXM9bG9vcDowAAISbG9vcF9jYXBhYmlsaXRpZXM9AAAGIDPTqKe/hckryPR6hINTa7Dg8/bbxqVqq02/eBMpmt7Z';
const makeToken = (m, p) => encode({macaroon: m, preimage: p}).toString('hex');

const makeArgs = override => {
  const args = {
    fetch,
    lnd: {
      default: {
        getInfo: ({}, cbk) => cbk(null, getInfoResponse),
      },
    },
    token: makeToken(Buffer.from(macaroon, 'base64'), Buffer.alloc(1, 1)),
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
      metadata: {get: () => [Buffer.alloc(1, 1).toString('hex')]},
      service: {},
      token: makeToken(Buffer.from(macaroon, 'base64'), Buffer.alloc(1, 1)),
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects}) => {
    if (!!error) {
      await rejects(getPaidService(args), error, 'Got expected error');
    } else {
      const paid = await getPaidService(args);

      equal(paid.macaroon, expected.macaroon, 'Got expected macaroon');
      equal(paid.paid, expected.paid, 'Got expected paid tokens');
      equal(paid.preimage, expected.preimage, 'Got expected preimage');
      equal(paid.token, expected.token, 'Got expected token');
    }

    return end();
  });
});
