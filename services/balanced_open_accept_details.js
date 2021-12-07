const {balancedChannelKeyTypes} = require('./service_key_types');
const {Transaction} = require('bitcoinjs-lib');

const bufferAsHex = buffer => buffer.toString('hex');
const hashHexLength = 64;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const isHexNumberSized = hex => hex.length < 14;
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const maxSignatureLength = 150;
const multiSigType = balancedChannelKeyTypes.multisig_public_key;
const parseHexNumber = hex => parseInt(hex, 16);
const sigHashAll = Buffer.from([Transaction.SIGHASH_ALL]);

/** Derive open accept details

  {
    records: [{
      type: <Record Type Number String>
      value: <Record Type Value Hex Encoded String>
    }]
  }

  @throws
  <Error>

  @returns
  {
    funding_signature: <Funding Signature Hex String>
    multisig_public_key: <Funding Public Key Hex String>
    transaction_id: <Funding Input Transaction Id Hex String>
    transaction_vout: <Funding Input Transaction Output Index Number>
    transit_public_key: <Funding Input Public Key Hex String>
  }
*/
module.exports = ({records}) => {
  const remoteMultiSigPublicKey = records.find(({type}) => {
    return type === multiSigType;
  });

  if (!remoteMultiSigPublicKey) {
    throw new Error('AcceptResponseMissingRemotePublicKey');
  }

  if (!isPublicKey(remoteMultiSigPublicKey.value)) {
    throw new Error('GotInvalidRemotePublicKey');
  }

  const transitTxId = records.find(({type}) => {
    return type === balancedChannelKeyTypes.transit_tx_id;
  });

  if (!transitTxId || transitTxId.value.length !== hashHexLength) {
    throw new Error('AcceptResponseMissingTransitTransactionId');
  }

  const transitTxVout = records.find(({type}) => {
    return type === balancedChannelKeyTypes.transit_tx_vout;
  });

  if (!transitTxVout || !isHexNumberSized(transitTxVout.value)) {
    throw new Error('AcceptResponseMissingTransitTransactionVout');
  }

  const fundSignature = records.find(({type}) => {
    return type === balancedChannelKeyTypes.funding_signature;
  });

  if (!fundSignature || fundSignature.value.length > maxSignatureLength) {
    throw new Error('AcceptResponseMissingFundingSignature');
  }

  const fundTransitKey = records.find(({type}) => {
    return type === balancedChannelKeyTypes.transit_public_key;
  });

  if (!fundTransitKey) {
    throw new Error('AcceptResponseMissingFundTransitKey');
  }

  if (!isPublicKey(fundTransitKey.value)) {
    throw new Error('GotInvalidFundingTransitPublicKey');
  }

  const fundingSignature = hexAsBuffer(fundSignature.value);

  const signature = Buffer.concat([fundingSignature, sigHashAll]);

  return {
    funding_signature: bufferAsHex(signature),
    multisig_public_key: remoteMultiSigPublicKey.value,
    transaction_id: transitTxId.value,
    transaction_vout: parseHexNumber(transitTxVout.value),
    transit_public_key: fundTransitKey.value,
  };
};
