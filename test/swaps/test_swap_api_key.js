const {test} = require('tap');

const {swapApiKey} = require('./../../swaps');

const tests = [
  {
    args: {},
    description: 'View or purchase is required',
    error: [400, 'ExpectedPurchaseOrApiKeyDetailsToView'],
  },
  {
    args: {api_key: 'api_key', is_purchase: true},
    description: 'Purchasing a new token expects no existing token',
    error: [400, 'PurchaseNotNeededWhenApiKeyProvided'],
  },
  {
    args: {api_key: 'api_key', macaroon: 'macaroon'},
    description: 'Decoding a token expects no existing macaroon',
    error: [400, 'MacaroonNotNeededWhenApiKeyProvided'],
  },
  {
    args: {api_key: 'api_key', preimage: 'preimage'},
    description: 'Decoding a token expects no existing preimage',
    error: [400, 'PreimageNotNeededWhenApiKeyProvided'],
  },
  {
    args: {is_purchase: true},
    description: 'Purchasing a new token requires lnd',
    error: [400, 'ExpectedLndWhenPurchaseIsRequested'],
  },
  {
    args: {is_purchase: true, lnd: {}},
    description: 'Purchasing a new token requires logger',
    error: [400, 'ExpectedLoggerWhenPurchaseIsRequested'],
  },
  {
    args: {is_purchase: true, lnd: {}, logger: {}, macaroon: 'macaroon'},
    description: 'Purchasing a new token expects no macaroon',
    error: [400, 'PurchaseNotNeededWhenMacaroonProvided'],
  },
  {
    args: {is_purchase: true, lnd: {}, logger: {}, preimage: 'preimage'},
    description: 'Purchasing a new token expects no preimage',
    error: [400, 'PurchaseNotNeededWhenPreimageProvided'],
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects}) => {
    if (!!error) {
      rejects(swapApiKey(args), error, 'Got expected error');
    } else {
      const service = await swapApiKey(args);

      equal(service.api_key, expected.api_key, 'Got expected API key');
      equal(service.swap_user_id, expected.swap_user_id, 'Got expected id');
    }

    return end();
  });
});
