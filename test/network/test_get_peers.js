const {test} = require('tap');

const {getInfoResponse} = require('./../fixtures');
const {getPeers} = require('./../../network');

const getInfoRes = () => JSON.parse(JSON.stringify(getInfoResponse));

const tests = [
  {
    args: {},
    description: 'Getting peers requires lnd',
    error: [400, 'ExpectedLndToGetPeers'],
  },
  {
    args: {lnd: {}},
    description: 'Getting peers requires an omit array',
    error: [400, 'ExpectedOmitArrayToGetPeers'],
  },
  {
    args: {
      lnd: {
        default: {
          closedChannels: ({}, cbk) => cbk(null, {channels: []}),
          getInfo: ({}, cbk) => cbk(null, getInfoRes()),
          listChannels: ({}, cbk) => cbk(null, {channels: []}),
        },
      },
      omit: [],
    },
    description: 'Getting peers with no channels returns nothing',
    expected: {peers: []},
  },
  {
    args: {
      lnd: {
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
          listChannels: ({}, cbk) => cbk(null, {channels: [{
            active: true,
            capacity: '1',
            chan_id: '1',
            channel_point: '00:1',
            commit_fee: 1,
            commit_weight: 1,
            fee_per_kw: 1,
            local_balance: 1,
            local_chan_reserve_sat: 1,
            num_updates: 1,
            pending_htlcs: [],
            private: false,
            remote_balance: 1,
            remote_chan_reserve_sat: 1,
            remote_pubkey: 'b',
            total_satoshis_received: 1,
            total_satoshis_sent: 1,
            unsettled_balance: 1,
          }]}),
        },
      },
      omit: [],
    },
    description: 'Getting peers with a channel returns peers',
    expected: {
      peers: [{
        alias: 'alias',
        fee_earnings: undefined,
        inbound_fee_rate: '0.00%',
        inbound_liquidity: '0.00000001',
        outbound_liquidity: '0.00000001',
        last_received: undefined,
        last_routed: undefined,
        public_key: 'b',
      }],
    },
  },
  {
    args: {
      inbound_liquidity_below: 1000,
      lnd: {
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
            fee_per_kw: 1,
            local_balance: 1,
            local_chan_reserve_sat: 1,
            num_updates: 1,
            pending_htlcs: [],
            private: false,
            remote_balance: 1,
            remote_chan_reserve_sat: 1,
            remote_pubkey: 'b',
            total_satoshis_received: 1,
            total_satoshis_sent: 1,
            unsettled_balance: 1,
          }]}),
        },
      },
      omit: [],
      outbound_liquidity_below: 1000,
    },
    description: 'Getting peers where a channel is missing returns peers',
    expected: {
      peers: [{
        alias: 'alias',
        fee_earnings: undefined,
        inbound_fee_rate: undefined,
        inbound_liquidity: '0.00000001',
        outbound_liquidity: '0.00000001',
        last_received: undefined,
        last_routed: undefined,
        public_key: 'b',
      }],
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({deepIs, end, equal, rejects}) => {
    if (!!error) {
      rejects(getPeers(args), error, 'Got expected error');
    } else {
      const {peers} = await getPeers(args);

      peers.forEach(n => delete n.first_connected);

      deepIs(peers, expected.peers, 'Got expected peers');
    }

    return end();
  });
});
