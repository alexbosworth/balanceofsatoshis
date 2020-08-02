const {test} = require('tap');

const {getInboundPath} = require('./../../routing');
const {getInfoResponse} = require('./../fixtures');

const getInfoRes = () => JSON.parse(JSON.stringify(getInfoResponse));

const makeLnd = ({channels}) => {
  return {
    default: {
      getChanInfo: (args, cbk) => {
        return cbk(null, channels.find(n => n.channel_id === args.chan_id));
      },
      getInfo: ({}, cbk) => cbk(null, getInfoRes()),
      getNodeInfo: ({}, cbk) => {
        return cbk(null, {
          channels: channels || [],
          node: {
            addresses: [],
            alias: 'b',
            channels: [],
            color: '#000000',
            features: {},
            last_update: 1,
            num_channels: 0,
            pub_key: Buffer.alloc(33),
          },
          num_channels: 0,
          total_capacity: '0',
        });
      },
      listChannels: ({}, cbk) => cbk(null, {channels: []}),
    },
  };
};

const tests = [
  {
    args: {},
    description: 'A final destination is required',
    error: [400, 'ExpectedDestinationToGetInboundPath'],
  },
  {
    args: {destination: 'b'},
    description: 'Lnd to get destination node is required',
    error: [400, 'ExpectedLndToGetInboundPath'],
  },
  {
    args: {destination: 'b', lnd: {}},
    description: 'Lnd to get destination node is required',
    error: [400, 'ExpectedInThroughPublicKeyHexString'],
  },
  {
    args: {destination: 'b', lnd: {}, through: 'a'},
    description: 'Lnd to get destination node is required',
    error: [400, 'ExpectedTokensToGetInboundPath'],
  },
  {
    args: {destination: 'b', lnd: makeLnd({}), through: 'a', tokens: 1},
    description: 'A connecting channel is required',
    error: [400, 'NoConnectingChannelToPayIn'],
  },
  {
    args: {
      destination: 'b',
      lnd: makeLnd({
        channels: [{
          capacity: '1',
          chan_point: `${Buffer.alloc(32).toString('hex')}:0`,
          channel_id: '12345',
          last_update: 12345,
          node1_policy: {
            disabled: false,
            fee_base_msat: '1',
            fee_rate_milli_msat: '1',
            last_update: 1,
            max_htlc_msat: '1',
            min_htlc: '1',
            time_lock_delta: 1,
          },
          node1_pub: Buffer.alloc(33, 0).toString('hex'),
          node2_policy: {
            disabled: false,
            fee_base_msat: '1',
            fee_rate_milli_msat: '1',
            last_update: 1,
            max_htlc_msat: '1',
            min_htlc: '1',
            time_lock_delta: 1,
          },
          node2_pub: Buffer.alloc(33, 1).toString('hex'),
        }],
      }),
      through: Buffer.alloc(33, 1).toString('hex'),
      tokens: 2,
    },
    description: 'A sufficient capacity channel is required',
    error: [400, 'NoSufficientCapacityConnectingChannelToPayIn'],
  },
  {
    args: {
      destination: Buffer.alloc(33, 0).toString('hex'),
      lnd: makeLnd({
        channels: [{
          capacity: '10',
          chan_point: `${Buffer.alloc(32).toString('hex')}:0`,
          channel_id: '12345',
          last_update: 12345,
          node1_policy: {
            disabled: false,
            fee_base_msat: '1',
            fee_rate_milli_msat: '1',
            last_update: 1,
            max_htlc_msat: '10000000',
            min_htlc: '1',
            time_lock_delta: 1,
          },
          node1_pub: Buffer.alloc(33, 0).toString('hex'),
          node2_policy: {
            disabled: false,
            fee_base_msat: '1',
            fee_rate_milli_msat: '1',
            last_update: 1,
            max_htlc_msat: '10000000',
            min_htlc: '1',
            time_lock_delta: 1,
          },
          node2_pub: Buffer.alloc(33, 1).toString('hex'),
        }],
      }),
      through: Buffer.alloc(33, 1).toString('hex'),
      tokens: 1,
    },
    description: 'A sufficient capacity channel is required',
    expected: {
      path: [
        {
          public_key: Buffer.alloc(33, 1).toString('hex'),
        },
        {
          base_fee_mtokens: '1',
          channel: '0x0x12345',
          channel_capacity: 10,
          cltv_delta: 1,
          fee_rate: 1,
          public_key: Buffer.alloc(33, 0).toString('hex'),
        },
      ],
    },
  },
  {
    args: {
      destination: Buffer.alloc(33, 0).toString('hex'),
      lnd: makeLnd({
        channels: [{
          capacity: '0',
          chan_point: `${Buffer.alloc(32).toString('hex')}:0`,
          channel_id: '12345',
          last_update: 12345,
          node1_policy: {
            disabled: false,
            fee_base_msat: '99',
            fee_rate_milli_msat: '99',
            last_update: 1,
            max_htlc_msat: '999999',
            min_htlc: '9',
            time_lock_delta: 9,
          },
          node1_pub: Buffer.alloc(33, 0).toString('hex'),
          node2_policy: {
            disabled: false,
            fee_base_msat: '1',
            fee_rate_milli_msat: '1',
            last_update: 1,
            max_htlc_msat: '1000000',
            min_htlc: '1',
            time_lock_delta: 1,
          },
          node2_pub: Buffer.alloc(33, 1).toString('hex'),
        }],
      }),
      through: Buffer.alloc(33, 1).toString('hex'),
      tokens: 1,
    },
    description: 'Finds inbound path within a max htlc limiter',
    expected: {
      path: [
        {
          public_key: Buffer.alloc(33, 1).toString('hex'),
        },
        {
          base_fee_mtokens: '1',
          channel: '0x0x12345',
          channel_capacity: 0,
          cltv_delta: 1,
          fee_rate: 1,
          public_key: Buffer.alloc(33, 0).toString('hex'),
        },
      ],
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects}) => {
    if (!!error) {
      rejects(getInboundPath(args), error, 'Got expected error');
    } else {
      const [expectedHop1, expectedHop2] = expected.path;
      const [hop1, hop2] = (await getInboundPath(args)).path;

      equal(hop1.public_key, expectedHop1.public_key, 'Hop 1 pubkey returned');
      equal(hop2.base_fee_mtokens, expectedHop2.base_fee_mtokens, 'Base toks');
      equal(hop2.channel, expectedHop2.channel, 'Got hop 2 channel');
      equal(hop2.channel_capacity, expectedHop2.channel_capacity, 'Hop2 cap');
      equal(hop2.cltv_delta, expectedHop2.cltv_delta, 'Got hop2 cltv delta');
      equal(hop2.fee_rate, expectedHop2.fee_rate, 'Got hop2 fee rate');
      equal(hop2.public_key, expectedHop2.public_key, 'Got hop2 public key');
    }

    return end();
  });
});
