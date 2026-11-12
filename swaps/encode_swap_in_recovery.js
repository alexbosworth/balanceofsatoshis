const {encodeAsCbor} = require('./../encryption');

const base64AsBuffer = base64 => Buffer.from(base64, 'base64');
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const isHash = n => !!n && /^[0-9A-F]{64}$/i.test(n);
const {isInteger} = Number;
const isPreimage = n => !!n && /^[0-9A-F]{64}$/i.test(n);
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);

/** Encode the recovery details of a shared address used for swaps in

  {
    expiry: <Shared Address Expiry Blocks Count Number>
    [htlc_hash]: <Fallback HTLC Swap Hash Hex String>
    [htlc_index]: <Fallback HTLC Refund Key Index Number>
    [htlc_service_public_key]: <Fallback HTLC Service Public Key Hex String>
    [htlc_start_height]: <Fallback HTLC Swap Creation Chain Height Number>
    [htlc_timeout]: <Fallback HTLC Timeout Height Number>
    index: <Shared Address Client Key Index Number>
    macaroon: <Paid Service Macaroon Base64 String>
    preimage: <Paid Service Macaroon Payment Preimage Hex String>
    service_public_key: <Shared Address Service Public Key Hex String>
    start_height: <Shared Address Creation Chain Height Number>
  }

  @throws
  <Error>

  @returns
  {
    recovery: <Shared Address Recovery Hex String>
  }
*/
module.exports = args => {
  if (!isInteger(args.expiry) || args.expiry < 1) {
    throw new Error('ExpectedExpiryBlocksCountToEncodeSwapInRecovery');
  }

  if (!isInteger(args.index) || args.index < 0) {
    throw new Error('ExpectedClientKeyIndexToEncodeSwapInRecovery');
  }

  if (!args.macaroon) {
    throw new Error('ExpectedServiceMacaroonToEncodeSwapInRecovery');
  }

  if (!isPreimage(args.preimage)) {
    throw new Error('ExpectedMacaroonPreimageToEncodeSwapInRecovery');
  }

  if (!isPublicKey(args.service_public_key)) {
    throw new Error('ExpectedServicePublicKeyToEncodeSwapInRecovery');
  }

  if (!isInteger(args.start_height) || args.start_height < 1) {
    throw new Error('ExpectedStartHeightToEncodeSwapInRecovery');
  }

  // A fallback HTLC in the recovery refunds a swap that is not paid
  const isHtlc = args.htlc_hash !== undefined;

  if (isHtlc && !isHash(args.htlc_hash)) {
    throw new Error('ExpectedHtlcHashToEncodeSwapInRecovery');
  }

  if (isHtlc && (!isInteger(args.htlc_index) || args.htlc_index < 0)) {
    throw new Error('ExpectedHtlcKeyIndexToEncodeSwapInRecovery');
  }

  if (isHtlc && !isPublicKey(args.htlc_service_public_key)) {
    throw new Error('ExpectedHtlcServiceKeyToEncodeSwapInRecovery');
  }

  if (isHtlc && !isInteger(args.htlc_start_height)) {
    throw new Error('ExpectedHtlcStartHeightToEncodeSwapInRecovery');
  }

  if (isHtlc && args.htlc_start_height < 1) {
    throw new Error('ExpectedHtlcStartHeightToEncodeSwapInRecovery');
  }

  if (isHtlc && (!isInteger(args.htlc_timeout) || args.htlc_timeout < 1)) {
    throw new Error('ExpectedHtlcTimeoutToEncodeSwapInRecovery');
  }

  // The address is tied to the paid macaroon, so the macaroon is recovered
  const value = {
    expiry: args.expiry,
    height: args.start_height,
    index: args.index,
    key: hexAsBuffer(args.service_public_key),
    macaroon: base64AsBuffer(args.macaroon),
    preimage: hexAsBuffer(args.preimage),
  };

  // Exit early when there is no fallback HTLC to recover
  if (!isHtlc) {
    return {recovery: encodeAsCbor({value}).cbor};
  }

  const {cbor} = encodeAsCbor({
    value: {
      ...value,
      htlc: {
        hash: hexAsBuffer(args.htlc_hash),
        height: args.htlc_start_height,
        index: args.htlc_index,
        key: hexAsBuffer(args.htlc_service_public_key),
        timeout: args.htlc_timeout,
      },
    },
  });

  return {recovery: cbor};
};
