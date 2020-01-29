const {encode} = require('cbor');
const {test} = require('tap');

const getPaidService = require('./../../swaps/get_paid_service');

const makeToken = (m, p) => encode({macaroon: m, preimage: p}).toString('hex');

const makeArgs = override => {
  const args = {
    lnd: {},
    logger: {},
    network: 'btc',
    token: makeToken(Buffer.alloc(1, 0), Buffer.alloc(1, 1)),
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
    args: makeArgs({logger: undefined}),
    description: 'Logger object is required',
    error: [400, 'ExpectedLoggerToGetPaidService'],
  },
  {
    args: makeArgs({network: undefined}),
    description: 'Network name is required',
    error: [400, 'ExpectedNetworkToGetPaidService'],
  },
  {
    args: makeArgs({network: 'network'}),
    description: 'Known network name is required',
    error: [400, 'FailedToFindSupportedSwapService'],
  },
  {
    args: makeArgs({}),
    description: 'A paid service object is returned',
    expected: {
      macaroon: Buffer.alloc(1, 0).toString('base64'),
      preimage: Buffer.alloc(1, 1).toString('hex'),
      service: {},
      token: makeToken(Buffer.alloc(1, 0), Buffer.alloc(1, 1)),
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects}) => {
    if (!!error) {
      rejects(getPaidService(args), error, 'Got expected error');
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
