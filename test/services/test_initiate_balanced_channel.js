const {deepEqual} = require('node:assert').strict;
const EventEmitter = require('node:events');
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {transactionFromComponents} = require('@alexbosworth/blockchain');

const {
  balancedChannelKeyTypes,
} = require('./../../services/service_key_types');
const {getInfoResponse} = require('./../fixtures');
const {getNodeInfoResponse} = require('./../fixtures');
const initiate = require('./../../services/initiate_balanced_channel');
const {listChannelsResponse} = require('./../fixtures');
const {listPeersResponse} = require('./../fixtures');
const {queryRoutesResponse} = require('./../fixtures');

const bufferAsHex = buffer => buffer.toString('hex');
const feeRateError = [400, 'ExpectedFeeRatePerVirtualByteToProposeChannel'];
const getInfoRes = () => JSON.parse(JSON.stringify(getInfoResponse));
getNodeInfoResponse.channels = [];
const request = 'lnbc1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq8rkx3yf5tcsyz3d73gafnh3cax9rn449d9p5uxz9ezhhypd0elx87sjle52x86fux2ypatgddc6k63n7erqz25le42c4u4ecky03ylcqca784w';

const transitAddress = 'bc1q6x8d58yysr8xpv0m4qm4vk8h72rzmx4vsznplm';

const makeArgs = overrides => {
  const args = {
    ask: (question, cbk) => {
      if (question.name === 'rate') {
        args.state.validations.push(question.validate(args.rate));
      }

      return cbk({
        capacity: 384,
        fund: transactionFromComponents({
          inputs: [{
            id: bufferAsHex(Buffer.alloc(32)),
            script: bufferAsHex(Buffer.alloc(32)),
            sequence: 0,
            vout: 0,
          }],
          locktime: 0,
          outputs: [{
            script: '001451814f108670aced2d77c1805ddd6634bc9d4731',
            tokens: args.funding_tokens,
          }],
          version: 1,
        }).transaction,
        rate: args.rate,
      });
    },
    attempts: 0,
    funding_tokens: 382,
    lnd: {
      default: {
        addInvoice: ({}, cbk) => cbk(null, {
          payment_addr: Buffer.alloc(32),
          payment_request: request,
          r_hash: Buffer.alloc(32),
        }),
        deletePayment: ({}, cbk) => cbk(),
        fundingStateStep: ({}, cbk) => cbk(),
        getChanInfo: ({}, cbk) => {
          return cbk(null, {
            capacity: '1',
            chan_point: `${Buffer.alloc(32).toString('hex')}:0`,
            channel_id: '000000000',
            node1_policy: {
              disabled: true,
              fee_base_msat: '1',
              fee_rate_milli_msat: '1',
              last_update: 1,
              max_htlc_msat: '1',
              min_htlc: '1',
              time_lock_delta: 1,
            },
            node1_pub: Buffer.alloc(33).toString('hex'),
            node2_policy: {
              disabled: false,
              fee_base_msat: '2',
              fee_rate_milli_msat: '2',
              last_update: 1,
              max_htlc_msat: '2',
              min_htlc: '2',
              time_lock_delta: 2,
            },
            node2_pub: Buffer.alloc(33, 1).toString('hex'),
          });
        },
        getInfo: ({}, cbk) => cbk(null, getInfoRes()),
        getNodeInfo: ({}, cbk) => cbk(null, getNodeInfoResponse),
        listChannels: ({}, cbk) => cbk(null, listChannelsResponse),
        listPeers: ({}, cbk) => cbk(null, {
          peers: [{
            address: 'address',
            bytes_recv: '1',
            bytes_sent: '1',
            features: {},
            flap_count: 0,
            inbound: true,
            last_flap_ns: '0',
            ping_time: '1',
            pub_key: '020000000000000000000000000000000000000000000000000000000000000000',
            sat_recv: '1',
            sat_sent: '1',
            sync_type: 'ACTIVE_SYNC',
          }]
        }),
        lookupInvoice: ({}, cbk) => cbk(null, {
          creation_date: '1',
          description_hash: Buffer.alloc(0),
          expiry: '1',
          features: {},
          htlcs: [],
          memo: 'memo',
          payment_addr: Buffer.alloc(32),
          payment_request: request,
          r_hash: Buffer.alloc(32),
          r_preimage: Buffer.alloc(32),
          settled: false,
          value: 1,
        }),
        newAddress: (args, cbk) => {
          return cbk(null, {
            address: transitAddress,
          });
        },
        openChannel: params => {
          const eventEmitter = new EventEmitter();

          eventEmitter.cancel = () => {};

          process.nextTick(() => {
            if (!!params.funding_shim.psbt_shim) {
              return eventEmitter.emit('data', {
                psbt_fund: {
                  funding_address: 'funding_address',
                  funding_amount: '1',
                },
                update: 'psbt_fund',
              });
            } else {
              return eventEmitter.emit('data', {update: 'chan_pending'});
            }
          });

          return eventEmitter;
        },
        queryRoutes: (query, cbk) => {
          const records = query.dest_custom_records || {};

          const record = records[balancedChannelKeyTypes.funding_tx_fee_rate];

          if (!!record) {
            args.state.fee_rates.push(parseInt(bufferAsHex(record), 16));
          }

          return cbk(null, queryRoutesResponse);
        },
      },
      invoices: {
        subscribeSingleInvoice: ({}) => {
          const eventEmitter = new EventEmitter();

          eventEmitter.cancel = () => {};

          process.nextTick(() => {
            const multiSigKeyTypeBuffer = Buffer.alloc(32);
            const transitPKeyTypeBuffer = Buffer.alloc(32);
            const transitTxIdTypeBuffer = Buffer.alloc(32);
            const transitVoutTypeBuffer = Buffer.alloc(32);
            const txSignatureTypeBuffer = Buffer.alloc(32);
            const vout = Buffer.from('03', 'hex');

            multiSigKeyTypeBuffer.writeBigUInt64LE(BigInt('80505'));
            transitPKeyTypeBuffer.writeBigUInt64LE(BigInt('80506'));
            transitTxIdTypeBuffer.writeBigUInt64LE(BigInt('80507'));
            transitVoutTypeBuffer.writeBigUInt64LE(BigInt('80508'));
            txSignatureTypeBuffer.writeBigUInt64LE(BigInt('80503'));

            const multiSigKeyType = multiSigKeyTypeBuffer.toString('ascii');
            const transitPKeyType = transitPKeyTypeBuffer.toString('ascii');
            const transitTxIdType = transitTxIdTypeBuffer.toString('ascii');
            const transitVoutType = transitVoutTypeBuffer.toString('ascii');
            const txSignatureType = txSignatureTypeBuffer.toString('ascii');

            return eventEmitter.emit('data', {
              add_index: '1',
              amt_paid_msat: '1',
              amt_paid_sat: '1000',
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
                  [multiSigKeyType]: Buffer.alloc(33, 2).toString('hex'),
                  [transitPKeyType]: Buffer.alloc(33, 3).toString('hex'),
                  [transitTxIdType]: Buffer.alloc(32).toString('hex'),
                  [transitVoutType]: vout.toString('hex'),
                  [txSignatureType]: Buffer.alloc(72).toString('hex'),
                },
                expiry_height: 1,
                htlc_index: '1',
                mpp_total_amt_msat: '1000',
                resolve_time: '1',
                state: 'SETTLED',
              }],
              is_keysend: true,
              memo: '',
              payment_addr: Buffer.alloc(32),
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
            });
          });

          return eventEmitter;
        },
      },
      router: {
        sendPaymentV2: args => {
          const eventEmitter = new EventEmitter();

          process.nextTick(() => {
            return eventEmitter.emit('data', {
              creation_date: '1',
              creation_time_ns: '1',
              failure_reason: '',
              fee_msat: '1000',
              fee_sat: '1',
              htlcs: [{
                attempt_time_ns: '1',
                resolve_time_ns: '1',
                route: {
                  hops: [],
                  total_amt: '1',
                  total_amt_msat: '1000',
                  total_fees: '1',
                  total_fees_msat: '1000',
                  total_time_lock: 1,
                },
                status: 'SUCCEEDED',
              }],
              path: [],
              payment_hash: Buffer.alloc(32).toString('hex'),
              payment_index: '1',
              payment_preimage: Buffer.alloc(32).toString('hex'),
              payment_request: request,
              status: 'SUCCEEDED',
              value: '1',
              value_msat: '1000',
              value_sat: '1',
            });
          });

          return eventEmitter;
        },
        sendToRouteV2: ({}, cbk) => {
          args.attempts++;

          if (args.attempts === 3) {
            return cbk(null, {
              preimage: Buffer.alloc(32),
            });
          }

          return cbk(null, {
            failure: {
              chan_id: '1',
              code: 'INCORRECT_OR_UNKNOWN_PAYMENT_DETAILS',
              failure_source_index: 1,
            },
          });
        },
      },
      signer: {
        signOutputRaw: ({}, cbk) => cbk(null, {raw_sigs: [Buffer.alloc(72)]}),
      },
      version: {
        getVersion: ({}, cbk) => cbk(null, {
          app_minor: 1,
          app_patch: 1,
          build_tags: ['autopilotrpc'],
          commit_hash: Buffer.alloc(20).toString('hex'),
        }),
      },
      wallet: {
        deriveKey: ({}, cbk) => cbk(null, {
          key_loc: {key_index: 0},
          raw_key_bytes: Buffer.alloc(33, 2),
        }),
        deriveNextKey: ({}, cbk) => cbk(null, {
          key_loc: {key_index: 0},
          raw_key_bytes: Buffer.alloc(33, 2),
        }),
        estimateFee: ({}, cbk) => cbk(null, {sat_per_kw: '250'}),
      },
    },
    logger: {info: () => {}},
    multisig_key_index: 1,
    network: 'btc',
    partner_public_key: '020000000000000000000000000000000000000000000000000000000000000000',
    rate: 2,
    refund_address: transitAddress.address,
    state: {fee_rates: [], validations: []},
    transit_address: transitAddress.address,
    transit_key_index: 0,
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const makeExpected = overrides => {
  const expected = {
    fee_rates: [2],
    validations: [true],
  };

  Object.keys(overrides).forEach(k => expected[k] = overrides[k]);

  return expected;
};

const tests = [
  {
    args: makeArgs({}),
    description: 'Initiate a balanced channel',
    expected: makeExpected({}),
  },
  {
    args: makeArgs({ask: undefined}),
    description: 'An interrogation function is expected',
    error: [400, 'ExpectedAskFunctionToInitBalancedChannel'],
    expected: makeExpected({fee_rates: [], validations: []}),
  },
  {
    args: makeArgs({
      funding_tokens: 1142, // (384 + 190 * 10) / 2, including fees
      rate: '10',
    }),
    description: 'String fee rates preserve the negotiated value',
    expected: makeExpected({fee_rates: [10]}),
  },
  {
    args: makeArgs({rate: 0}),
    description: 'A zero fee rate is rejected',
    error: feeRateError,
    expected: makeExpected({fee_rates: [], validations: [false]}),
  },
  {
    args: makeArgs({rate: -1}),
    description: 'A negative fee rate is rejected',
    error: feeRateError,
    expected: makeExpected({fee_rates: [], validations: [false]}),
  },
  {
    args: makeArgs({rate: 1.5}),
    description: 'A fractional fee rate is rejected',
    error: feeRateError,
    expected: makeExpected({fee_rates: [], validations: [false]}),
  },
  {
    args: makeArgs({rate: Infinity}),
    description: 'An infinite fee rate is rejected',
    error: feeRateError,
    expected: makeExpected({fee_rates: [], validations: [false]}),
  },
  {
    args: makeArgs({rate: ''}),
    description: 'An empty fee rate is rejected',
    error: feeRateError,
    expected: makeExpected({fee_rates: [], validations: [false]}),
  },
  {
    args: makeArgs({rate: 'invalid'}),
    description: 'A nonnumeric fee rate is rejected',
    error: feeRateError,
    expected: makeExpected({fee_rates: [], validations: [false]}),
  },
  {
    args: makeArgs({rate: Number.MAX_SAFE_INTEGER + 1}),
    description: 'An unsafe integer fee rate is rejected',
    error: feeRateError,
    expected: makeExpected({fee_rates: [], validations: [false]}),
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(initiate(args), error, 'Got expected error');
    } else {
      await initiate(args);
    }

    deepEqual(args.state, expected, 'Got expected fee rates and validations');
  });
});
