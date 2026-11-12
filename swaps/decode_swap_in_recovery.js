const {decodeCbor} = require('./../encryption');

const bufferAsBase64 = buffer => buffer.toString('base64');
const bufferAsHex = buffer => buffer.toString('hex');
const hashByteLength = 32;
const {isBuffer} = Buffer;
const {isInteger} = Number;
const preimageByteLength = 32;
const publicKeyByteLength = 33;

/** Decode the recovery details of a shared address used for swaps in

  {
    recovery: <Shared Address Recovery Hex String>
  }

  @throws
  <Error>

  @returns
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
*/
module.exports = ({recovery}) => {
  if (!recovery) {
    throw new Error('ExpectedRecoveryToDecodeSwapInRecovery');
  }

  try {
    decodeCbor({cbor: recovery});
  } catch (err) {
    throw new Error('ExpectedCborEncodedSwapInRecoveryToDecode');
  }

  const {value} = decodeCbor({cbor: recovery});

  if (!value) {
    throw new Error('ExpectedRecoveryDetailsInSwapInRecovery');
  }

  if (!isInteger(value.expiry) || value.expiry < 1) {
    throw new Error('ExpectedExpiryBlocksCountInSwapInRecovery');
  }

  if (!isInteger(value.height) || value.height < 1) {
    throw new Error('ExpectedStartHeightInSwapInRecovery');
  }

  if (!isInteger(value.index) || value.index < 0) {
    throw new Error('ExpectedClientKeyIndexInSwapInRecovery');
  }

  if (!isBuffer(value.key) || value.key.length !== publicKeyByteLength) {
    throw new Error('ExpectedServicePublicKeyInSwapInRecovery');
  }

  if (!isBuffer(value.macaroon) || !value.macaroon.length) {
    throw new Error('ExpectedServiceMacaroonInSwapInRecovery');
  }

  const {preimage} = value;

  if (!isBuffer(preimage) || preimage.length !== preimageByteLength) {
    throw new Error('ExpectedMacaroonPreimageInSwapInRecovery');
  }

  const details = {
    expiry: value.expiry,
    index: value.index,
    macaroon: bufferAsBase64(value.macaroon),
    preimage: bufferAsHex(value.preimage),
    service_public_key: bufferAsHex(value.key),
    start_height: value.height,
  };

  // Exit early when there is no fallback HTLC to recover
  if (value.htlc === undefined) {
    return details;
  }

  const {htlc} = value;

  if (!htlc || !isBuffer(htlc.hash) || htlc.hash.length !== hashByteLength) {
    throw new Error('ExpectedHtlcHashInSwapInRecovery');
  }

  if (!isInteger(htlc.height) || htlc.height < 1) {
    throw new Error('ExpectedHtlcStartHeightInSwapInRecovery');
  }

  if (!isInteger(htlc.index) || htlc.index < 0) {
    throw new Error('ExpectedHtlcKeyIndexInSwapInRecovery');
  }

  if (!isBuffer(htlc.key) || htlc.key.length !== publicKeyByteLength) {
    throw new Error('ExpectedHtlcServiceKeyInSwapInRecovery');
  }

  if (!isInteger(htlc.timeout) || htlc.timeout < 1) {
    throw new Error('ExpectedHtlcTimeoutInSwapInRecovery');
  }

  return {
    ...details,
    htlc_hash: bufferAsHex(htlc.hash),
    htlc_index: htlc.index,
    htlc_service_public_key: bufferAsHex(htlc.key),
    htlc_start_height: htlc.height,
    htlc_timeout: htlc.timeout,
  };
};
