const {createSignedRequest} = require('invoices');
const {createUnsignedRequest} = require('invoices');
const secp256k1 = require('tiny-secp256k1');

const {
  balancedChannelKeyTypes,
} = require('./../../services/service_key_types');

const bufferAsHex = buffer => buffer.toString('hex');
const hexAsBuffer = hex => Buffer.from(hex, 'hex');

const recordKey = type => {
  const buffer = Buffer.alloc(32);

  buffer.writeBigUInt64LE(BigInt(type));

  return buffer.toString('ascii');
};

const createRequest = () => {
  const key = Buffer.alloc(32, 1);
  const {hash, hrp, tags} = createUnsignedRequest({
    created_at: '2017-06-01T10:57:38.000Z',
    description: 'Balanced channel acceptance',
    id: bufferAsHex(Buffer.alloc(32)),
    network: 'bitcoin',
    payment: bufferAsHex(Buffer.alloc(32, 1)),
    tokens: 1,
  });

  const publicKey = Buffer.from(secp256k1.pointFromScalar(key));
  const signature = Buffer.from(secp256k1.sign(hexAsBuffer(hash), key));

  return createSignedRequest({
    hrp,
    tags,
    destination: bufferAsHex(publicKey),
    signature: bufferAsHex(signature),
  }).request;
};

const capacityType = recordKey(balancedChannelKeyTypes.channel_capacity);
const feeType = recordKey(balancedChannelKeyTypes.funding_tx_fee_rate);
const keyType = recordKey(balancedChannelKeyTypes.multisig_public_key);
const request = createRequest();
const requestType = recordKey(balancedChannelKeyTypes.accept_request);
const txType = recordKey(balancedChannelKeyTypes.transit_tx_id);
const voutType = recordKey(balancedChannelKeyTypes.transit_tx_vout);

const invoice = {
  add_index: '1',
  amt_paid_msat: '10000',
  amt_paid_sat: '10',
  cltv_expiry: '1',
  creation_date: '1',
  description_hash: Buffer.alloc(0),
  expiry: '1',
  fallback_addr: '',
  features: {},
  htlcs: [{
    accept_height: 1,
    accept_time: '1',
    amt_msat: '1000',
    chan_id: '1',
    custom_records: {
      [capacityType]: (2e6).toString(16),
      [feeType]: (255).toString(16),
      [keyType]: bufferAsHex(Buffer.alloc(33, 2)),
      [requestType]: Buffer.from(request),
      [txType]: bufferAsHex(Buffer.alloc(32)),
      [voutType]: (255).toString(16),
    },
    expiry_height: 1,
    htlc_index: '1',
    mpp_total_amt_msat: '1000',
    resolve_time: '1',
    state: 'SETTLED',
  }],
  is_keysend: true,
  memo: '',
  payment_addr: Buffer.alloc(0),
  payment_request: '',
  private: false,
  r_hash: Buffer.alloc(32),
  r_preimage: Buffer.alloc(32),
  route_hints: [],
  settle_date: '1',
  settle_index: '1',
  settled: true,
  state: 'SETTLED',
  value: '1',
  value_msat: '1000',
};

module.exports = {invoice, request};
