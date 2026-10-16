const {equal} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {getInfoResponse} = require('./../fixtures');
const {getLiquidity} = require('./../../balances');
const {listChannelsResponse} = require('./../fixtures');
const {versionInfoResponse} = require('./../fixtures');

const otherKey = Buffer.alloc(33, 3).toString('hex');
const peerKey = listChannelsResponse.channels[0].remote_pubkey;

const friendsTag = {
  alias: 'friends',
  id: Buffer.alloc(32, 1).toString('hex'),
};

const strangersTag = {
  alias: 'strangers',
  id: Buffer.alloc(32, 2).toString('hex'),
};

const fs = {getFile: ({}, cbk) => cbk('err')};

const tagsFs = {
  getFile: ({}, cbk) => cbk(null, Buffer.from(JSON.stringify({
    tags: [
      {...friendsTag, nodes: [peerKey]},
      {...strangersTag, nodes: [otherKey]},
    ],
  }))),
};

const makePolicy = ({feeRate}) => {
  return {
    disabled: false,
    fee_base_msat: '1000',
    fee_rate_milli_msat: String(feeRate),
    last_update: 1,
    max_htlc_msat: '1000',
    min_htlc: '1000',
    time_lock_delta: 40,
  };
};

const makeLnd = ({peerFeeRate}) => {
  return {
    default: {
      getInfo: ({}, cbk) => cbk(null, getInfoResponse),
      getNodeInfo: ({}, cbk) => cbk(null, {
        channels: [{
          capacity: '1',
          chan_point: `${Buffer.alloc(32).toString('hex')}:0`,
          channel_id: '1',
          node1_policy: makePolicy({feeRate: 1}),
          node1_pub: getInfoResponse.identity_pubkey,
          node2_policy: makePolicy({feeRate: peerFeeRate || 1}),
          node2_pub: peerKey,
        }],
        node: {
          addresses: [],
          alias: 'alias',
          color: '#000000',
          features: {},
          last_update: '1',
          pub_key: getInfoResponse.identity_pubkey,
        },
        num_channels: '1',
        total_capacity: '1',
      }),
      listChannels: ({}, cbk) => cbk(null, listChannelsResponse),
      pendingChannels: ({}, cbk) => cbk(null, {
        pending_closing_channels: [],
        pending_force_closing_channels: [],
        pending_open_channels: [],
        total_limbo_balance: '1',
      }),
    },
    version: {
      getVersion: ({}, cbk) => cbk(null, versionInfoResponse),
    },
  };
};

const tests = [
  {
    args: {fs},
    description: 'LND is required',
    error: [400, 'ExpectedLndToGetLiquidity'],
  },
  {
    args: {fs, is_outbound: true, lnd: makeLnd({}), max_fee_rate: 0},
    description: 'Max liquidity fee rate is not supported for outbound lookup',
    error: [400, 'MaxLiquidityFeeRateNotSupportedForOutbound'],
  },
  {
    args: {fs, lnd: makeLnd({})},
    description: 'Get liquidity',
    expected: {balance: 1},
  },
  {
    args: {fs, lnd: makeLnd({peerFeeRate: 100}), max_fee_rate: 100},
    description: 'Inbound liquidity at or under the max fee rate is counted',
    expected: {balance: 1},
  },
  {
    args: {fs, lnd: makeLnd({peerFeeRate: 101}), max_fee_rate: 100},
    description: 'Inbound liquidity over the max fee rate is not counted',
    expected: {balance: 0},
  },
  {
    args: {
      fs: tagsFs,
      lnd: makeLnd({peerFeeRate: 101}),
      max_fee_rate: 100,
      with: friendsTag.alias,
    },
    description: 'The max fee rate applies to liquidity with a tag',
    expected: {balance: 0},
  },
  {
    args: {lnd: makeLnd({})},
    description: 'Fs methods are required',
    error: [400, 'ExpectedFsMethodsToGetLiquidity'],
  },
  {
    args: {fs, is_outbound: true, lnd: makeLnd({})},
    description: 'Get outbound liquidity',
    expected: {balance: 1},
  },
  {
    args: {fs, below: 5, is_outbound: true, lnd: makeLnd({})},
    description: 'Get outbound liquidity below an amount',
    expected: {balance: 4},
  },
  {
    args: {fs, is_top: true, lnd: makeLnd({})},
    description: 'Get top liquidity',
    expected: {balance: 1},
  },
  {
    args: {fs, lnd: makeLnd({}), with: peerKey},
    description: 'Get liquidity with a peer public key',
    expected: {balance: 1},
  },
  {
    args: {fs, lnd: makeLnd({}), with: otherKey},
    description: 'Get liquidity with a node that is not a peer',
    expected: {balance: 0},
  },
  {
    args: {fs: tagsFs, lnd: makeLnd({}), with: friendsTag.id},
    description: 'Get liquidity with a tag referenced by id',
    expected: {balance: 1},
  },
  {
    args: {fs: tagsFs, lnd: makeLnd({}), with: friendsTag.alias},
    description: 'Get liquidity with a tag referenced by alias',
    expected: {balance: 1},
  },
  {
    args: {fs: tagsFs, lnd: makeLnd({}), with: strangersTag.alias},
    description: 'Get liquidity with a tag of nodes that are not peers',
    expected: {balance: 0},
  },
  {
    args: {fs: tagsFs, lnd: makeLnd({}), with: peerKey},
    description: 'Get liquidity with a public key when there are tags',
    expected: {balance: 1},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(getLiquidity(args), error, 'Got expected error');
    } else {
      const balances = await getLiquidity(args);

      equal(balances.balance, expected.balance, 'Balance is calculated');
    }

    return;
  });
});
