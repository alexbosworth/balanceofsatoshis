const {test} = require('tap');

const {getNodeInfoResponse} = require('./../fixtures');
const {listChannelsResponse} = require('./../fixtures');
const {listPeersResponse} = require('./../fixtures');
const {reconnect} = require('./../../network');

const makeLnd = ({channels, getNodeErr}) => {
  return {
    default: {
      connectPeer: ({}, cbk) => cbk(),
      disconnectPeer: ({}, cbk) => cbk(),
      getNodeInfo: ({}, cbk) => cbk(getNodeErr, getNodeInfoResponse),
      listChannels: ({}, cbk) => cbk(null, channels || listChannelsResponse),
      listPeers: ({}, cbk) => cbk(null, listPeersResponse),
    },
  };
};

const tests = [
  {
    args: {},
    description: 'An LND object is expected',
    error: 'ExpectedLndToReconnectToDisconnectedPeers',
  },
  {
    args: {lnd: makeLnd({}), retries: 1},
    description: 'Peers are reconnected',
    expected: [{
      alias: 'alias',
      public_key: '000000000000000000000000000000000000000000000000000000000000000000',
    }],
  },
  {
    args: {
      lnd: makeLnd({
        channels: {
          "channels": [{
            "active": true,
            "capacity": "1",
            "chan_id": "1",
            "chan_status_flags": "1",
            "channel_point": "00:0",
            "commit_fee": "1",
            "commit_weight": "1",
            "csv_delay": "1",
            "fee_per_kw": "1",
            "initiator": true,
            "lifetime": "1",
            "local_balance": "1",
            "local_chan_reserve_sat": "1",
            "local_constraints": {
              "chan_reserve_sat": "1",
              "csv_delay": 1,
              "dust_limit_sat": "1",
              "max_accepted_htlcs": 1,
              "max_pending_amt_msat": "1",
              "min_htlc_msat": "1"
            },
            "num_updates": "1",
            "pending_htlcs": [],
            "private": false,
            "remote_balance": "1",
            "remote_chan_reserve_sat": "1",
            "remote_constraints": {
              "chan_reserve_sat": "1",
              "csv_delay": 1,
              "dust_limit_sat": "1",
              "max_accepted_htlcs": 1,
              "max_pending_amt_msat": "1",
              "min_htlc_msat": "1"
            },
            "remote_pubkey": "010000000000000000000000000000000000000000000000000000000000000000",
            "static_remote_key": true,
            "thaw_height": 0,
            "total_satoshis_received": "1",
            "total_satoshis_sent": "1",
            "unsettled_balance": "1",
            "uptime": "1"
          }],
        },
      }),
      retries: 1,
    },
    description: 'Inactive channel peers are disconnected and reconnected',
    expected: [{
      alias: 'alias',
      public_key: '000000000000000000000000000000000000000000000000000000000000000000',
    }],
  },
  {
    args: {lnd: makeLnd({getNodeErr: 'err'}), retries: 1},
    description: 'Error getting node means no reconnect',
    expected: [],
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({deepIs, end, rejects}) => {
    if (!!error) {
      await rejects(reconnect(args), error, 'Got expected error');
    } else {
      const {reconnected} = reconnect(args);

      deepIs(reconnected, expected.reconnected, 'Got expected reconnections');
    }

    return end();
  });
});
