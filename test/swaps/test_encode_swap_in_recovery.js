const {deepEqual} = require('node:assert').strict;
const test = require('node:test');
const {throws} = require('node:assert').strict;

const encodeSwapInRecovery = require('./../../swaps/encode_swap_in_recovery');

const bufferAsBase64 = buffer => buffer.toString('base64');
const hash = '04'.repeat(32);
const htlcKey = `03${'06'.repeat(32)}`;
const key = `02${'01'.repeat(32)}`;
const preimage = '03'.repeat(32);

const macaroon = bufferAsBase64(Buffer.alloc(3, 2));

// The fallback HTLC of a swap, to refund the swap if the service does not pay
const htlc = {
  htlc_hash: hash,
  htlc_index: 5,
  htlc_service_public_key: htlcKey,
  htlc_start_height: 10,
  htlc_timeout: 2026,
};

// The recovery is a CBOR map of the shared address and service token details
const recovery = `a6666578706972791901f4666865696768740965696e64657803636b65795821${key}686d616361726f6f6e4302020268707265696d6167655820${preimage}`;

// The fallback HTLC details are a CBOR map within the recovery map
const recoveryWithHtlc = `a7666578706972791901f4666865696768740965696e64657803636b65795821${key}686d616361726f6f6e4302020268707265696d6167655820${preimage}6468746c63a564686173685820${hash}666865696768740a65696e64657805636b65795821${htlcKey}6774696d656f75741907ea`;

const makeArgs = override => {
  const args = {
    macaroon,
    preimage,
    expiry: 500,
    index: 3,
    service_public_key: key,
    start_height: 9,
  };

  Object.keys(override).forEach(k => args[k] = override[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({expiry: undefined}),
    description: 'An expiry is expected',
    error: 'ExpectedExpiryBlocksCountToEncodeSwapInRecovery',
  },
  {
    args: makeArgs({index: undefined}),
    description: 'A client key index is expected',
    error: 'ExpectedClientKeyIndexToEncodeSwapInRecovery',
  },
  {
    args: makeArgs({macaroon: undefined}),
    description: 'A service macaroon is expected',
    error: 'ExpectedServiceMacaroonToEncodeSwapInRecovery',
  },
  {
    args: makeArgs({preimage: undefined}),
    description: 'A macaroon preimage is expected',
    error: 'ExpectedMacaroonPreimageToEncodeSwapInRecovery',
  },
  {
    args: makeArgs({service_public_key: undefined}),
    description: 'A service public key is expected',
    error: 'ExpectedServicePublicKeyToEncodeSwapInRecovery',
  },
  {
    args: makeArgs({start_height: undefined}),
    description: 'A start height is expected',
    error: 'ExpectedStartHeightToEncodeSwapInRecovery',
  },
  {
    args: makeArgs({...htlc, htlc_hash: '00'}),
    description: 'A fallback HTLC hash is expected to be a hash',
    error: 'ExpectedHtlcHashToEncodeSwapInRecovery',
  },
  {
    args: makeArgs({...htlc, htlc_index: undefined}),
    description: 'A fallback HTLC refund key index is expected',
    error: 'ExpectedHtlcKeyIndexToEncodeSwapInRecovery',
  },
  {
    args: makeArgs({...htlc, htlc_service_public_key: hash}),
    description: 'A fallback HTLC service public key is expected',
    error: 'ExpectedHtlcServiceKeyToEncodeSwapInRecovery',
  },
  {
    args: makeArgs({...htlc, htlc_start_height: undefined}),
    description: 'A fallback HTLC start height is expected',
    error: 'ExpectedHtlcStartHeightToEncodeSwapInRecovery',
  },
  {
    args: makeArgs({...htlc, htlc_start_height: 0}),
    description: 'A fallback HTLC start height is expected to be a height',
    error: 'ExpectedHtlcStartHeightToEncodeSwapInRecovery',
  },
  {
    args: makeArgs({...htlc, htlc_timeout: undefined}),
    description: 'A fallback HTLC timeout height is expected',
    error: 'ExpectedHtlcTimeoutToEncodeSwapInRecovery',
  },
  {
    args: makeArgs({}),
    description: 'Recovery details are encoded',
    expected: {recovery},
  },
  {
    args: makeArgs(htlc),
    description: 'Recovery details with a fallback HTLC are encoded',
    expected: {recovery: recoveryWithHtlc},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, () => {
    if (!!error) {
      throws(() => encodeSwapInRecovery(args), new Error(error), 'Got error');
    } else {
      deepEqual(encodeSwapInRecovery(args), expected, 'Got expected recovery');
    }

    return;
  });
});
