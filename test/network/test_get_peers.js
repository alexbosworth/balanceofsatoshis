const EventEmitter = require('events');

const {test} = require('@alexbosworth/tap');

const {getInfoResponse} = require('./../fixtures');
const {getPeers} = require('./../../network');
const {listChannelsResponse} = require('./../fixtures');
const {pendingChannelsResponse} = require('./../fixtures');
const {versionInfoResponse} = require('./../fixtures');

const getInfoRes = () => JSON.parse(JSON.stringify(getInfoResponse));

const makeArgs = overrides => {
  const args = {
    fs: {getFile: ({}, cbk) => cbk()},
    lnd: {
      chain: {
        registerBlockEpochNtfn: ({}) => {
          const emitter = new EventEmitter();

          emitter.cancel = () => {};

          process.nextTick(() => emitter.emit('error', 'err'));

          return emitter;
        },
      },
      default: {
        closedChannels: ({}, cbk) => cbk(null, {channels: []}),
        getInfo: ({}, cbk) => cbk(null, getInfoRes()),
        listChannels: ({}, cbk) => cbk(null, {channels: []}),
        listPeers: ({}, cbk) => cbk(null, {peers: []}),
        pendingChannels: ({}, cbk) => cbk(null, pendingChannelsResponse),
      },
      version: {
        getVersion: ({}, cbk) => cbk(null, versionInfoResponse),
      },
    },
    omit: [],
    tags: [],
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({lnd: undefined}),
    description: 'Getting peers requires lnd',
    error: [400, 'ExpectedLndToGetPeers'],
  },
  {
    args: makeArgs({omit: undefined}),
    description: 'Getting peers requires an omit array',
    error: [400, 'ExpectedOmitArrayToGetPeers'],
  },
  {
    args: makeArgs({sort_by: []}),
    description: 'Getting peers requires only one sort factor',
    error: [400, 'SortingByMultipleFieldsNotSupported'],
  },
  {
    args: makeArgs({}),
    description: 'Getting peers with no channels returns nothing',
    expected: {peers: []},
  },
  {
    args: makeArgs({
      lnd: {
        chain: {
          registerBlockEpochNtfn: ({}) => {
            const emitter = new EventEmitter();

            emitter.cancel = () => {};

            process.nextTick(() => emitter.emit('error', 'err'));

            return emitter;
          },
        },
        default: {
          closedChannels: ({}, cbk) => cbk(null, {channels: []}),
          getChanInfo: ({}, cbk) => cbk(null, {
            capacity: '1',
            chan_point: '1:1',
            channel_id: 1,
            node1_policy: {
              disabled: false,
              fee_base_msat: '1',
              fee_rate_milli_msat: '1',
              last_update: 1,
              max_htlc_msat: '1',
              min_htlc: '1',
              time_lock_delta: 1,
            },
            node1_pub: 'a',
            node2_policy: {
              disabled: false,
              fee_base_msat: '2',
              fee_rate_milli_msat: '2',
              last_update: 2,
              max_htlc_msat: '2',
              min_htlc: '2',
              time_lock_delta: 2,
            },
            node2_pub: 'b',
          }),
          getInfo: ({}, cbk) => cbk(null, getInfoRes()),
          getNodeInfo: ({}, cbk) => cbk(null, {
            node: {
              addresses: [],
              alias: 'alias',
              color: '#000000',
              features: {},
              last_update: 1,
              pub_key: 'b',
            },
            num_channels: 1,
            total_capacity: '1',
          }),
          pendingChannels: ({}, cbk) => cbk(null, pendingChannelsResponse),
          listChannels: ({}, cbk) => cbk(null, {channels: [{
            active: true,
            capacity: '1',
            chan_id: '1',
            channel_point: '00:1',
            commit_fee: 1,
            commit_weight: 1,
            commitment_type: 'LEGACY',
            fee_per_kw: 1,
            local_balance: 1,
            local_chan_reserve_sat: 1,
            local_constraints: {
              chan_reserve_sat: '1',
              csv_delay: 1,
              dust_limit_sat: '1',
              max_accepted_htlcs: 1,
              max_pending_amt_msat: '1',
              min_htlc_msat: '1',
            },
            num_updates: 1,
            pending_htlcs: [],
            private: false,
            remote_balance: 1,
            remote_chan_reserve_sat: 1,
            remote_constraints: {
              chan_reserve_sat: '1',
              csv_delay: 1,
              dust_limit_sat: '1',
              max_accepted_htlcs: 1,
              max_pending_amt_msat: '1',
              min_htlc_msat: '1',
            },
            remote_pubkey: 'b',
            thaw_height: 0,
            total_satoshis_received: 1,
            total_satoshis_sent: 1,
            unsettled_balance: 1,
          }]}),
          listPeers: ({}, cbk) => cbk(null, {peers: []}),
        },
        version: {
          getVersion: ({}, cbk) => cbk(null, versionInfoResponse),
        },
      },
    }),
    description: 'Getting peers with a channel returns peers',
    expected: {
      peers: [{
        alias: 'alias',
        fee_earnings: undefined,
        downtime_percentage: undefined,
        last_activity: undefined,
        inbound_fee_rate: '0.00% (2)',
        inbound_liquidity: 1,
        is_forwarding: undefined,
        is_inbound_disabled: undefined,
        is_offline: true,
        is_pending: undefined,
        is_private: undefined,
        is_thawing: undefined,
        outbound_liquidity: 1,
        public_key: 'b',
      }],
    },
  },
  {
    args: makeArgs({
      fs: {getFile: ({}, cbk) => cbk()},
      inbound_liquidity_below: 1000,
      lnd: {
        chain: {
          registerBlockEpochNtfn: ({}) => {
            const emitter = new EventEmitter();

            emitter.cancel = () => {};

            process.nextTick(() => emitter.emit('error', 'err'));

            return emitter;
          },
        },
        default: {
          closedChannels: ({}, cbk) => cbk(null, {channels: []}),
          getChanInfo: ({}, cbk) => cbk({details: 'edge not found'}),
          getInfo: ({}, cbk) => cbk(null, getInfoRes()),
          getNodeInfo: ({}, cbk) => cbk(null, {
            node: {
              addresses: [],
              alias: 'alias',
              color: '#000000',
              features: {},
              last_update: 1,
              pub_key: 'b',
            },
            num_channels: 1,
            total_capacity: '1',
          }),
          listChannels: ({}, cbk) => cbk(null, {channels: [{
            active: true,
            capacity: '1',
            chan_id: '1',
            channel_point: '00:1',
            commit_fee: 1,
            commit_weight: 1,
            commitment_type: 'LEGACY',
            fee_per_kw: 1,
            local_balance: 1,
            local_chan_reserve_sat: 1,
            local_constraints: {
              chan_reserve_sat: '1',
              csv_delay: 1,
              dust_limit_sat: '1',
              max_accepted_htlcs: 1,
              max_pending_amt_msat: '1',
              min_htlc_msat: '1',
            },
            num_updates: 1,
            pending_htlcs: [],
            private: false,
            remote_balance: 1,
            remote_chan_reserve_sat: 1,
            remote_constraints: {
              chan_reserve_sat: '1',
              csv_delay: 1,
              dust_limit_sat: '1',
              max_accepted_htlcs: 1,
              max_pending_amt_msat: '1',
              min_htlc_msat: '1',
            },
            remote_pubkey: 'b',
            thaw_height: 0,
            total_satoshis_received: 1,
            total_satoshis_sent: 1,
            unsettled_balance: 1,
          }]}),
          listPeers: ({}, cbk) => cbk(null, {peers: []}),
          pendingChannels: ({}, cbk) => cbk(null, pendingChannelsResponse),
        },
        version: {
          getVersion: ({}, cbk) => cbk(null, versionInfoResponse),
        },
      },
      outbound_liquidity_below: 1000,
    }),
    description: 'Getting peers where a channel is missing returns peers',
    expected: {
      peers: [{
        alias: 'alias',
        fee_earnings: undefined,
        downtime_percentage: undefined,
        last_activity: undefined,
        inbound_fee_rate: undefined,
        inbound_liquidity: 1,
        is_forwarding: undefined,
        is_inbound_disabled: undefined,
        is_offline: true,
        is_pending: undefined,
        is_private: undefined,
        is_thawing: undefined,
        outbound_liquidity: 1,
        public_key: 'b',
      }],
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects, strictSame}) => {
    if (!!error) {
      rejects(getPeers(args), error, 'Got expected error');
    } else {
      const {peers} = await getPeers(args);

      peers.forEach(n => delete n.first_connected);

      strictSame(peers, expected.peers, 'Got expected peers');
    }

    return end();
  });
});
