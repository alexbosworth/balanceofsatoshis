const {deepEqual} = require('node:assert').strict;
const EventEmitter = require('node:events');
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {getInfoResponse} = require('./../fixtures');
const {getNodeInfoResponse} = require('./../fixtures');
const {listChannelsResponse} = require('./../fixtures');
const method = require('./../../network/get_node_pending');
const {pendingChannelsResponse} = require('./../fixtures');
const {versionInfoResponse} = require('./../fixtures');

const clone = n => JSON.parse(JSON.stringify(n));
const nodeKey = Buffer.concat([Buffer.from('02', 'hex'), Buffer.alloc(32)]);
const peerA = Buffer.alloc(33).toString('hex');
const peerB = Buffer.alloc(33, 1).toString('hex');
const peerC = Buffer.alloc(33, 2).toString('hex');
const peerD = Buffer.alloc(33, 3).toString('hex');
const peerE = Buffer.alloc(33, 4).toString('hex');

const makeHtlc = overrides => {
  const htlc = {
    amount: '100',
    expiration_height: 500,
    forwarding_channel: '0',
    forwarding_htlc_index: '0',
    hash_lock: Buffer.alloc(32),
    htlc_index: '1',
    incoming: false,
  };

  Object.keys(overrides).forEach(k => htlc[k] = overrides[k]);

  return htlc;
};

const makeChannel = overrides => {
  const [channel] = clone(listChannelsResponse).channels;

  Object.keys(overrides).forEach(k => channel[k] = overrides[k]);

  return channel;
};

const makePendingChannel = overrides => {
  const channel = {
    capacity: '1000000',
    channel_point: 'ab:0',
    initiator: 'INITIATOR_LOCAL',
    local_balance: '500000',
    local_chan_reserve_sat: '1',
    remote_balance: '500000',
    remote_chan_reserve_sat: '1',
    remote_node_pub: peerC,
  };

  Object.keys(overrides).forEach(k => channel[k] = overrides[k]);

  return channel;
};

const makeHop = overrides => {
  const hop = {
    amt_to_forward_msat: '100000',
    chan_id: '2',
    custom_records: {},
    expiry: 500,
    fee_msat: '1000',
    pub_key: peerB,
    tlv_payload: true,
  };

  Object.keys(overrides).forEach(k => hop[k] = overrides[k]);

  return hop;
};

const makePayment = overrides => {
  const payment = {
    creation_date: '1',
    creation_time_ns: '1000000000',
    fee_msat: '1000',
    fee_sat: '1',
    htlcs: [{
      attempt_id: '1',
      attempt_time_ns: '1000000000',
      resolve_time_ns: '0',
      route: {
        hops: [
          makeHop({amt_to_forward_msat: '101000'}),
          makeHop({chan_id: '3', fee_msat: '0', pub_key: peerC}),
        ],
        total_amt_msat: '101000',
        total_fees_msat: '1000',
        total_time_lock: 500,
      },
      status: 'IN_FLIGHT',
    }],
    payment_hash: Buffer.alloc(32).toString('hex'),
    payment_index: '1',
    payment_preimage: Buffer.alloc(32).toString('hex'),
    payment_request: '',
    status: 'IN_FLIGHT',
    value_msat: '100000',
    value_sat: '100',
  };

  Object.keys(overrides).forEach(k => payment[k] = overrides[k]);

  return payment;
};

const makeLnd = ({channels, listChannelsErr, payments, pending}) => {
  const nodeInfo = clone(getNodeInfoResponse);

  // Node channels are not needed to look up an alias
  nodeInfo.channels = [];

  return {
    default: {
      getInfo: ({}, cbk) => cbk(null, clone(getInfoResponse)),
      getNodeInfo: ({}, cbk) => cbk(null, nodeInfo),
      listChannels: ({}, cbk) => {
        return cbk(listChannelsErr, {channels: channels || []});
      },
      pendingChannels: ({}, cbk) => cbk(null, pending || {
        pending_closing_channels: [],
        pending_force_closing_channels: [],
        pending_open_channels: [],
        total_limbo_balance: '0',
        waiting_close_channels: [],
      }),
    },
    router: {
      trackPaymentV2: ({payment_hash}) => {
        const emitter = new EventEmitter();
        const hash = payment_hash.toString('hex');

        const payment = (payments || []).find(n => n.payment_hash === hash);

        emitter.cancel = () => {};

        // Payments that are not found are reported as not initiated
        process.nextTick(() => {
          if (!payment) {
            return emitter.emit('error', {details: `payment isn't initiated`});
          }

          return emitter.emit('data', payment);
        });

        return emitter;
      },
    },
    version: {
      getVersion: ({}, cbk) => cbk(null, versionInfoResponse),
    },
  };
};

const logger = {debug: () => {}};

// A logger that keeps a record of what is logged for debugging
const makeLogger = () => {
  const logs = [];

  return {logs, debug: debug => logs.push(debug)};
};

const tests = [
  {
    args: {},
    description: 'LND is required to get node pending items',
    error: [400, 'ExpectedAuthenticatedLndToGetNodePendingItems'],
  },
  {
    args: {lnd: makeLnd({})},
    description: 'A logger is required to get node pending items',
    error: [400, 'ExpectedLoggerToGetNodePendingItems'],
  },
  {
    args: {logger, lnd: makeLnd({listChannelsErr: 'err'})},
    description: 'Errors getting channels are passed back',
    error: [503, 'UnexpectedGetChannelsError', {err: 'err'}],
  },
  {
    args: {lnd: makeLnd({}), logger: makeLogger()},
    debug: [],
    description: 'Nothing pending means empty pending items are returned',
    expected: {
      closing: [],
      forwarding: [],
      opening: [],
      sending: [],
      alias: undefined,
      public_key: nodeKey.toString('hex'),
    },
  },
  {
    args: {
      lnd: makeLnd({
        channels: [
          makeChannel({
            pending_htlcs: [
              makeHtlc({
                amount: '101',
                expiration_height: 540,
                forwarding_channel: '2',
                forwarding_htlc_index: '3',
                htlc_index: '1',
                incoming: true,
              }),
            ],
          }),
          makeChannel({
            chan_id: '2',
            channel_point: '01:0',
            pending_htlcs: [
              makeHtlc({
                amount: '100',
                forwarding_channel: '1',
                forwarding_htlc_index: '1',
                htlc_index: '3',
              }),
              makeHtlc({amount: '101', htlc_index: '4'}),
              makeHtlc({
                amount: '502',
                hash_lock: Buffer.alloc(32, 1),
                htlc_index: '5',
              }),
              makeHtlc({
                amount: '25',
                expiration_height: 400,
                hash_lock: Buffer.alloc(32, 2),
                htlc_index: '6',
              }),
              makeHtlc({
                amount: '301',
                hash_lock: Buffer.alloc(32, 3),
                htlc_index: '7',
              }),
            ],
            remote_pubkey: peerB,
          }),
        ],
        payments: [
          makePayment({creation_time_ns: '3000000000'}),
          makePayment({
            creation_time_ns: '2000000000',
            htlcs: [
              {
                attempt_id: '2',
                attempt_time_ns: '1000000000',
                resolve_time_ns: '0',
                route: {
                  hops: [
                    makeHop({amt_to_forward_msat: '502000', fee_msat: '2000'}),
                    makeHop({
                      amt_to_forward_msat: '500000',
                      chan_id: '3',
                      fee_msat: '0',
                      pub_key: nodeKey.toString('hex'),
                    }),
                  ],
                  total_amt_msat: '502000',
                  total_fees_msat: '2000',
                  total_time_lock: 500,
                },
                status: 'IN_FLIGHT',
              },
              {
                attempt_id: '3',
                attempt_time_ns: '1000000000',
                resolve_time_ns: '0',
                route: {
                  hops: [
                    makeHop({amt_to_forward_msat: '502000', fee_msat: '2000'}),
                    makeHop({
                      amt_to_forward_msat: '500000',
                      chan_id: '3',
                      fee_msat: '0',
                      pub_key: peerD,
                    }),
                  ],
                  total_amt_msat: '502000',
                  total_fees_msat: '2000',
                  total_time_lock: 400,
                },
                status: 'IN_FLIGHT',
              },
            ],
            payment_hash: Buffer.alloc(32, 1).toString('hex'),
            value_msat: '500000',
            value_sat: '500',
          }),
          makePayment({
            htlcs: [{
              attempt_id: '5',
              attempt_time_ns: '1000000000',
              resolve_time_ns: '0',
              route: {
                hops: [
                  makeHop({amt_to_forward_msat: '300000'}),
                  makeHop({
                    amt_to_forward_msat: '300000',
                    chan_id: '5',
                    fee_msat: '0',
                    pub_key: peerE,
                  }),
                  makeHop({
                    amt_to_forward_msat: '300000',
                    chan_id: '3',
                    fee_msat: '0',
                    pub_key: nodeKey.toString('hex'),
                  }),
                ],
                total_amt_msat: '301000',
                total_fees_msat: '1000',
                total_time_lock: 500,
              },
              status: 'IN_FLIGHT',
            }],
            payment_hash: Buffer.alloc(32, 3).toString('hex'),
            value_msat: '300000',
            value_sat: '300',
          }),
        ],
        pending: {
          pending_closing_channels: [],
          pending_force_closing_channels: [
            {
              blocks_til_maturity: 144,
              channel: makePendingChannel({}),
              closing_txid: 'cd',
              limbo_balance: '500000',
              maturity_height: 1144,
              pending_htlcs: [],
              recovered_balance: '0',
            },
            {
              blocks_til_maturity: 10,
              channel: makePendingChannel({
                channel_point: 'ab:1',
                remote_node_pub: peerE,
              }),
              closing_txid: 'cd',
              limbo_balance: '400000',
              maturity_height: 1010,
              pending_htlcs: [],
              recovered_balance: '0',
            },
          ],
          pending_open_channels: pendingChannelsResponse.pending_open_channels,
          total_limbo_balance: '900001',
          waiting_close_channels: [{
            channel: makePendingChannel({
              channel_point: 'ef:0',
              remote_node_pub: peerD,
            }),
            limbo_balance: '1',
          }],
        },
      }),
      logger: makeLogger(),
    },
    debug: [{
      forwarding_htlcs: [{
        fee: 1,
        in_peer: peerA,
        out_peer: peerB,
        payment: Buffer.alloc(32).toString('hex'),
        timeout: 540,
        tokens: 100,
      }],
      outgoing_htlcs: [
        {
          id: Buffer.alloc(32).toString('hex'),
          out_channel: '0x0x2',
          out_peer: peerB,
          timeout: 500,
          tokens: 101,
        },
        {
          id: Buffer.alloc(32, 1).toString('hex'),
          out_channel: '0x0x2',
          out_peer: peerB,
          timeout: 500,
          tokens: 502,
        },
        {
          id: Buffer.alloc(32, 2).toString('hex'),
          out_channel: '0x0x2',
          out_peer: peerB,
          timeout: 400,
          tokens: 25,
        },
        {
          id: Buffer.alloc(32, 3).toString('hex'),
          out_channel: '0x0x2',
          out_peer: peerB,
          timeout: 500,
          tokens: 301,
        },
      ],
      payments: [
        {
          id: Buffer.alloc(32).toString('hex'),
          created_at: '1970-01-01T00:00:03.000Z',
          paths: [{
            hops: [`0x0x2 ${peerB}`, `0x0x3 ${peerC}`],
            timeout: 500,
            tokens: 101,
          }],
        },
        {
          id: Buffer.alloc(32, 1).toString('hex'),
          created_at: '1970-01-01T00:00:02.000Z',
          paths: [
            {
              hops: [`0x0x2 ${peerB}`, `0x0x3 ${nodeKey.toString('hex')}`],
              timeout: 500,
              tokens: 502,
            },
            {
              hops: [`0x0x2 ${peerB}`, `0x0x3 ${peerD}`],
              timeout: 400,
              tokens: 502,
            },
          ],
        },
        {
          id: Buffer.alloc(32, 2).toString('hex'),
          created_at: undefined,
          paths: [],
        },
        {
          id: Buffer.alloc(32, 3).toString('hex'),
          created_at: '1970-01-01T00:00:01.000Z',
          paths: [{
            hops: [
              `0x0x2 ${peerB}`,
              `0x0x5 ${peerE}`,
              `0x0x3 ${nodeKey.toString('hex')}`,
            ],
            timeout: 500,
            tokens: 301,
          }],
        },
      ],
      pending_channels: [
        {
          blocks_until_expiry: undefined,
          capacity: 1000000,
          close_transaction_id: 'cd',
          is_closing: true,
          is_opening: false,
          is_partner_initiated: false,
          is_timelocked: true,
          local_balance: 500000,
          partner_public_key: peerC,
          pending_balance: 500000,
          pending_payments: [],
          remote_balance: 500000,
          timelock_blocks: 144,
          timelock_expiration: 1144,
          transaction_id: 'ab',
          transaction_vout: 0,
        },
        {
          blocks_until_expiry: undefined,
          capacity: 1000000,
          close_transaction_id: 'cd',
          is_closing: true,
          is_opening: false,
          is_partner_initiated: false,
          is_timelocked: true,
          local_balance: 500000,
          partner_public_key: peerE,
          pending_balance: 400000,
          pending_payments: [],
          remote_balance: 500000,
          timelock_blocks: 10,
          timelock_expiration: 1010,
          transaction_id: 'ab',
          transaction_vout: 1,
        },
        {
          blocks_until_expiry: undefined,
          capacity: 1,
          close_transaction_id: undefined,
          is_closing: false,
          is_opening: true,
          is_partner_initiated: false,
          is_timelocked: false,
          local_balance: 1,
          partner_public_key: peerA,
          pending_balance: undefined,
          pending_payments: undefined,
          remote_balance: 1,
          timelock_blocks: undefined,
          timelock_expiration: undefined,
          transaction_id: '00',
          transaction_vout: 0,
        },
        {
          blocks_until_expiry: undefined,
          capacity: 1000000,
          close_transaction_id: undefined,
          is_closing: true,
          is_opening: false,
          is_partner_initiated: false,
          is_timelocked: false,
          local_balance: 500000,
          partner_public_key: peerD,
          pending_balance: 1,
          pending_payments: undefined,
          remote_balance: 500000,
          timelock_blocks: undefined,
          timelock_expiration: undefined,
          transaction_id: 'ef',
          transaction_vout: 0,
        },
      ],
    }],
    description: 'Pending channels and in-flight HTLCs are returned',
    expected: {
      closing: [
        {
          blocks_until_recovery: 10,
          close_transaction_id: 'cd',
          peer_alias: 'alias',
          peer_public_key: peerE,
          pending_balance: 400000,
        },
        {
          blocks_until_recovery: 144,
          close_transaction_id: 'cd',
          peer_alias: 'alias',
          peer_public_key: peerC,
          pending_balance: 500000,
        },
        {
          blocks_until_recovery: undefined,
          close_transaction_id: undefined,
          peer_alias: 'alias',
          peer_public_key: peerD,
          pending_balance: 1,
        },
      ],
      forwarding: [{
        fee: 1,
        in_peer_alias: 'alias',
        in_peer_public_key: peerA,
        out_peer_alias: 'alias',
        out_peer_public_key: peerB,
        tokens: 100,
      }],
      opening: [{
        capacity: 1,
        is_partner_initiated: false,
        peer_alias: 'alias',
        peer_public_key: peerA,
        transaction_id: '00',
      }],
      sending: [
        {
          fee: 1,
          hops: [
            {alias: 'alias', public_key: peerB},
            {alias: 'alias', public_key: peerE},
            {alias: 'alias', public_key: nodeKey.toString('hex')},
          ],
          is_rebalance: true,
          tokens: 300,
        },
        {
          fee: 2,
          hops: [
            {alias: 'alias', public_key: peerB},
            {alias: 'alias', public_key: nodeKey.toString('hex')},
          ],
          is_rebalance: true,
          tokens: 500,
        },
        {
          fee: 1,
          hops: [
            {alias: 'alias', public_key: peerB},
            {alias: 'alias', public_key: peerC},
          ],
          is_rebalance: false,
          tokens: 100,
        },
        {
          fee: undefined,
          hops: [{alias: 'alias', public_key: peerB}],
          is_rebalance: false,
          tokens: 25,
        },
      ],
      alias: undefined,
      public_key: nodeKey.toString('hex'),
    },
  },
];

tests.forEach(({args, debug, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(method(args), error, 'Got expected error');
    } else {
      const pending = await method(args);

      deepEqual(pending, expected, 'Got expected node pending items');
    }

    if (!!debug) {
      deepEqual(args.logger.logs, debug, 'Got expected debug logs');
    }

    return;
  });
});
