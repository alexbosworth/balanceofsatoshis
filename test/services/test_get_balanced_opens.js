const {createSignedRequest} = require('invoices');
const {createUnsignedRequest} = require('invoices');
const sign = require('secp256k1').ecdsaSign;
const {test} = require('tap');

const getBalancedOpens = require('./../../services/get_balanced_opens');

const createRequest = () => {
  const {hash, hrp, tags} = createUnsignedRequest({
    created_at: '2017-06-01T10:57:38.000Z',
    description: 'coffee beans',
    features: [
      {
        bit: 15,
        is_required: false,
        type: 'payment_identifier',
      },
      {
        bit: 99,
        is_required: false,
        type: undefined,
      },
    ],
    id: '0001020304050607080900010203040506070809000102030405060708090102',
    network: 'bitcoin',
    payment: '1111111111111111111111111111111111111111111111111111111111111111',
    tokens: 1,
  });

  const bufFromHex = hex => Buffer.from(hex, 'hex');
  const privateKey = 'e126f68f7eafcc8b74f54d269fe206be715000f94dac067d1c04a8ca3b2db734';

  const {signature} = sign(bufFromHex(hash), bufFromHex(privateKey));

  const {request} = createSignedRequest({
    hrp,
    tags,
    destination: '03e7156ae33b0a208d0744199163177e909e80176e55d97a2f221ede0f934dd9ad',
    signature: Buffer.from(signature).toString('hex'),
  });

  return request;
};

const recordKey = number => {
  const buf = Buffer.alloc(32);

  buf.writeBigUInt64LE(BigInt(number));

  return buf.toString('ascii');
};

const testRequest = createRequest();

const makeArgs = overrides => {
  const args = {
    lnd: {
      default: {
        listInvoices: ({}, cbk) => {
          return cbk(null, {
            invoices: [{
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
                  [recordKey(80501)]: Buffer.from(testRequest),
                  [recordKey(80502)]: (2e6).toString(16),
                  [recordKey(80504)]: (255).toString(16),
                  [recordKey(80505)]: Buffer.alloc(33, 2).toString('hex'),
                  [recordKey(80507)]: Buffer.alloc(32).toString('hex'),
                  [recordKey(80508)]: (255).toString(16),
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
            }],
            last_index_offset: '1',
          });
        },
      },
    },
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({}),
    description: 'Get balanced opens',
    expected: {
      incoming: [{
        accept_request: testRequest,
        capacity: 2e6,
        fee_rate: 255,
        partner_public_key: '03e7156ae33b0a208d0744199163177e909e80176e55d97a2f221ede0f934dd9ad',
        proposed_at: '1970-01-01T00:00:01.000Z',
        remote_multisig_key: '020202020202020202020202020202020202020202020202020202020202020202',
        remote_tx_id: '0000000000000000000000000000000000000000000000000000000000000000',
        remote_tx_vout: 255,
      }],
    },
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'Authenticated LND is expected',
    error: [400, 'ExpectedAuthenticatedLndToGetBalancedOpens'],
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({deepIs, end, equal, rejects}) => {
    if (!!error) {
      await rejects(getBalancedOpens(args), error, 'Got error');
    } else {
      const {incoming} = await getBalancedOpens(args);

      deepIs(incoming, expected.incoming, 'Got expected balanced opens');
    }

    return end();
  });
});
