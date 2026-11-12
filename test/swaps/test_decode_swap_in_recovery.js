const {deepEqual} = require('node:assert').strict;
const test = require('node:test');
const {throws} = require('node:assert').strict;

const decodeSwapInRecovery = require('./../../swaps/decode_swap_in_recovery');
const {encodeAsCbor} = require('./../../encryption');

const bufferAsBase64 = buffer => buffer.toString('base64');
const bufferAsHex = buffer => buffer.toString('hex');
const key = Buffer.alloc(33, 1);
const macaroon = Buffer.alloc(3, 2);
const preimage = Buffer.alloc(32, 3);

// The fallback HTLC of a swap, to refund the swap if the service does not pay
const htlc = {
  hash: Buffer.alloc(32, 4),
  height: 10,
  index: 5,
  key: Buffer.alloc(33, 6),
  timeout: 2026,
};

// A recovery is a CBOR encoded map of the shared address details
const makeRecovery = override => {
  const value = {key, macaroon, preimage, expiry: 500, height: 9, index: 3};

  Object.keys(override).forEach(k => value[k] = override[k]);

  return encodeAsCbor({value}).cbor;
};

// The details decoded from a recovery made by makeRecovery
const makeExpected = override => {
  const expected = {
    expiry: 500,
    index: 3,
    macaroon: bufferAsBase64(macaroon),
    preimage: bufferAsHex(preimage),
    service_public_key: bufferAsHex(key),
    start_height: 9,
  };

  Object.keys(override).forEach(k => expected[k] = override[k]);

  return expected;
};

const tests = [
  {
    args: {},
    description: 'A recovery is expected',
    error: 'ExpectedRecoveryToDecodeSwapInRecovery',
  },
  {
    args: {recovery: 'ff'},
    description: 'A CBOR encoded recovery is expected',
    error: 'ExpectedCborEncodedSwapInRecoveryToDecode',
  },
  {
    args: {recovery: makeRecovery({expiry: 0})},
    description: 'An expiry is expected',
    error: 'ExpectedExpiryBlocksCountInSwapInRecovery',
  },
  {
    args: {recovery: makeRecovery({height: 0})},
    description: 'A start height is expected',
    error: 'ExpectedStartHeightInSwapInRecovery',
  },
  {
    args: {recovery: makeRecovery({index: 'index'})},
    description: 'A client key index is expected',
    error: 'ExpectedClientKeyIndexInSwapInRecovery',
  },
  {
    args: {recovery: makeRecovery({key: Buffer.alloc(32)})},
    description: 'A service public key is expected',
    error: 'ExpectedServicePublicKeyInSwapInRecovery',
  },
  {
    args: {recovery: makeRecovery({macaroon: Buffer.alloc(0)})},
    description: 'A service macaroon is expected',
    error: 'ExpectedServiceMacaroonInSwapInRecovery',
  },
  {
    args: {recovery: makeRecovery({preimage: Buffer.alloc(31)})},
    description: 'A macaroon preimage is expected',
    error: 'ExpectedMacaroonPreimageInSwapInRecovery',
  },
  {
    args: {recovery: makeRecovery({htlc: null})},
    description: 'Fallback HTLC details are expected to be a map',
    error: 'ExpectedHtlcHashInSwapInRecovery',
  },
  {
    args: {recovery: makeRecovery({htlc: {...htlc, hash: Buffer.alloc(31)}})},
    description: 'A fallback HTLC hash is expected',
    error: 'ExpectedHtlcHashInSwapInRecovery',
  },
  {
    args: {recovery: makeRecovery({htlc: {...htlc, height: 0}})},
    description: 'A fallback HTLC start height is expected',
    error: 'ExpectedHtlcStartHeightInSwapInRecovery',
  },
  {
    args: {recovery: makeRecovery({htlc: {...htlc, index: -1}})},
    description: 'A fallback HTLC refund key index is expected',
    error: 'ExpectedHtlcKeyIndexInSwapInRecovery',
  },
  {
    args: {recovery: makeRecovery({htlc: {...htlc, key: Buffer.alloc(32)}})},
    description: 'A fallback HTLC service public key is expected',
    error: 'ExpectedHtlcServiceKeyInSwapInRecovery',
  },
  {
    args: {recovery: makeRecovery({htlc: {...htlc, timeout: 0}})},
    description: 'A fallback HTLC timeout height is expected',
    error: 'ExpectedHtlcTimeoutInSwapInRecovery',
  },
  {
    args: {recovery: makeRecovery({})},
    description: 'Recovery details are decoded',
    expected: makeExpected({}),
  },
  {
    args: {recovery: makeRecovery({htlc})},
    description: 'Recovery details with a fallback HTLC are decoded',
    expected: makeExpected({
      htlc_hash: bufferAsHex(htlc.hash),
      htlc_index: 5,
      htlc_service_public_key: bufferAsHex(htlc.key),
      htlc_start_height: 10,
      htlc_timeout: 2026,
    }),
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, () => {
    if (!!error) {
      throws(() => decodeSwapInRecovery(args), new Error(error), 'Got error');
    } else {
      deepEqual(decodeSwapInRecovery(args), expected, 'Got expected details');
    }

    return;
  });
});
