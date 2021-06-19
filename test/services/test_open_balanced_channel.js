const EventEmitter = require('events');

const {address} = require('bitcoinjs-lib');
const {networks} = require('bitcoinjs-lib');
const {test} = require('@alexbosworth/tap');
const {Transaction} = require('bitcoinjs-lib');

const {getInfoResponse} = require('./../fixtures');
const {getNodeInfoResponse} = require('./../fixtures');
const {listChannelsResponse} = require('./../fixtures');
const openBalancedChannels = require('./../../services/open_balanced_channel');
const {queryRoutesResponse} = require('./../fixtures');

const getInfoRes = () => JSON.parse(JSON.stringify(getInfoResponse));
const {toOutputScript} = address;

const recordKey = number => {
  const buf = Buffer.alloc(32);

  buf.writeBigUInt64LE(BigInt(number));

  return buf.toString('ascii');
};

const request = 'lnbc10n1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypq9q5sqqqqqqqqqqqqqqqpqqqdq5vdhkven9v5sxyetpdeessp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygsw70s3erf2pvrhl8f8mzf458p5sgqqax5wdn0y97tf8mhfa9uqyyjlms4frz9awg3sqfrcru5pxaq46xknh7l4dcelqk52nkt7sxyy0cptc8xzp';
const transitAddress = 'bc1q6x8d58yysr8xpv0m4qm4vk8h72rzmx4vsznplm';

const makeArgs = overrides => {
  const args = {
    ask: ({}, cbk) => {
      const tx = new Transaction();

      const script = toOutputScript(transitAddress, networks.mainnet);

      tx.addInput(Buffer.alloc(32), 0);

      tx.addOutput(script, 2048450);

      return cbk({
        accept: true,
        capacity: 4096710,
        fund: tx.toHex(),
        key: '03e7156ae33b0a208d0744199163177e909e80176e55d97a2f221ede0f934dd9ad',
        rate: 1,
      });
    },
    lnd: {
      default: {
        addInvoice: ({}, cbk) => cbk(null, {
          payment_addr: Buffer.alloc(32),
          payment_request: request,
          r_hash: Buffer.alloc(32),
        }),
        fundingStateStep: ({}, cbk) => cbk(),
        getInfo: ({}, cbk) => cbk(null, getInfoRes()),
        getNodeInfo: ({}, cbk) => cbk(null, getNodeInfoResponse),
        listChannels: ({}, cbk) => cbk(null, listChannelsResponse),
        listInvoices: ({}, cbk) => cbk(null, {
          first_index_offset: '0',
          invoices: [{
            add_index: '1',
            amt_paid_msat: '1000',
            amt_paid_sat: '1',
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
                [recordKey(80501)]: Buffer.from(request),
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
          }],
          last_index_offset: '0',
        }),
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
            pub_key: '03e7156ae33b0a208d0744199163177e909e80176e55d97a2f221ede0f934dd9ad',
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
        pendingChannels: ({}, cbk) => cbk(null, {
          pending_closing_channels: [],
          pending_force_closing_channels: [],
          pending_open_channels: [{
            channel: {
              capacity: '1',
              channel_point: '6b7d9534fdef631b474b5174b9f88d33df1f813ab74c9d0ed29d7038cc7ef12a:0',
              local_balance: 1000000,
              local_chan_reserve_sat: '1',
              remote_balance: '1',
              remote_chan_reserve_sat: '1',
              remote_node_pub: '03e7156ae33b0a208d0744199163177e909e80176e55d97a2f221ede0f934dd9ad',
            },
            commit_fee: '1',
            commit_weight: '1',
            confirmation_height: 1,
            fee_per_kw: '1',
          }],
          total_limbo_balance: '1',
          waiting_close_channels: [],
        }),
        queryRoutes: ({}, cbk) => {
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
              state: '',
              value: '1',
              value_msat: '1000',
            });
          });

          return eventEmitter;
        },
      },
      router: {
        sendPaymentV2: ({}) => {
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
        sendToRoute: (args, cbk) => {
          overrides.state.attempts++;

          if (overrides.state.attempts === 3) {
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
        signOutputRaw: ({}, cbk) => cbk(null, {raw_sigs: [Buffer.alloc(1)]}),
      },
      wallet: {
        deriveKey: ({}, cbk) => cbk(null, {
          key_loc: {key_index: 0},
          raw_key_bytes: Buffer.from('03e7156ae33b0a208d0744199163177e909e80176e55d97a2f221ede0f934dd9ad', 'hex'),
        }),
        deriveNextKey: ({}, cbk) => cbk(null, {
          key_loc: {key_index: 0},
          raw_key_bytes: Buffer.from('03e7156ae33b0a208d0744199163177e909e80176e55d97a2f221ede0f934dd9ad', 'hex'),
        }),
        estimateFee: ({}, cbk) => cbk(null, {sat_per_kw: '250'}),
        publishTransaction: ({}, cbk) => cbk(null, {}),
      },
    },
    logger: {error: () => {}, info: () => {}},
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({state: {attempts: 0}}),
    description: 'Open balanced channel',
  },
  {
    args: makeArgs({ask: undefined}),
    description: 'An interrogation function is expected',
    error: [400, 'ExpectedInterrogationFunctionToOpenBalancedChan'],
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects, strictSame}) => {
    if (!!error) {
      await rejects(openBalancedChannels(args, args.test), error, 'Got error');
    } else {
      await openBalancedChannels(args);
    }

    return end();
  });
});
