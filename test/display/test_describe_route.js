const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {gray} = require('colorette');
const {greenBright} = require('colorette');
const {redBright} = require('colorette');

const {describeRoute} = require('./../../display');
const {getNodeInfoResponse} = require('./../fixtures');

const key = n => Buffer.alloc(33, n).toString('hex');

// A node that is not in the graph, so its alias is unknown
const unknownLnd = {default: {getNodeInfo: ({}, cbk) => cbk('err')}};

// A node in the graph with an emoji in its alias
const knownLnd = {
  default: {
    getNodeInfo: ({pub_key}, cbk) => {
      return cbk(null, {
        ...getNodeInfoResponse,
        channels: [],
        node: {...getNodeInfoResponse.node, pub_key, alias: '🦊 alias'},
      });
    },
  },
};

const makeHop = overrides => {
  const hop = {
    channel: '0x0x1',
    channel_capacity: 1,
    fee: 1,
    fee_mtokens: '1000',
    forward: 1,
    forward_mtokens: '1000',
    public_key: key(0),
    timeout: 1,
  };

  Object.keys(overrides).forEach(k => hop[k] = overrides[k]);

  return hop;
};

const makeRoute = overrides => {
  const route = {
    fee: 1,
    fee_mtokens: '1000',
    hops: [makeHop({})],
    mtokens: '1000',
    safe_fee: 1,
    safe_tokens: 1,
    timeout: 1,
    tokens: 1,
  };

  Object.keys(overrides).forEach(k => route[k] = overrides[k]);

  return route;
};

const makeArgs = overrides => {
  const args = {lnd: unknownLnd, route: makeRoute({})};

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const makeExpected = overrides => {
  const expected = {
    description: [`${gray('0x0x1')} `, `${key(0)}. Fee rate: 100%`],
  };

  Object.keys(overrides).forEach(k => expected[k] = overrides[k]);

  return expected;
};

const tests = [
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is required to describe a route',
    error: [400, 'ExpectedLndObjectToGenerateRouteDescription'],
  },
  {
    args: makeArgs({route: undefined}),
    description: 'A route is required to describe a route',
    error: [400, 'ExpectedRouteToGenerateRouteDescriptionFor'],
  },
  {
    args: makeArgs({}),
    description: 'A route is described',
    expected: makeExpected({}),
  },
  {
    args: makeArgs({route: makeRoute({confidence: 9e5})}),
    description: 'A route is described with its confidence',
    expected: makeExpected({
      description: [`${gray('0x0x1')} ★ ★ ★ ★`, `${key(0)}. Fee rate: 100%`],
    }),
  },
  {
    args: makeArgs({lnd: knownLnd}),
    description: 'A route is described with emoji-free aliases',
    expected: makeExpected({
      description: [
        `${gray('0x0x1')} `,
        `${greenBright('alias')} ${key(0)}. Fee rate: 100%`,
      ],
    }),
  },
  {
    args: makeArgs({
      lnd: knownLnd,
      tagged: [{icons: ['🏷'], public_key: key(0)}],
    }),
    description: 'A route is described with the icons of tags',
    expected: makeExpected({
      description: [
        `${gray('0x0x1')} `,
        `${greenBright('🏷 alias')} ${key(0)}. Fee rate: 100%`,
      ],
    }),
  },
  {
    args: makeArgs({
      route: makeRoute({
        hops: [
          makeHop({timeout: 2}),
          makeHop({channel: '0x0x2', public_key: key(2)}),
        ],
      }),
    }),
    description: 'A two hop route is described',
    expected: makeExpected({
      description: [
        `${gray('0x0x1')} `,
        `${key(0)}. Fee rate: 100%`,
        gray('0x0x2x0'),
      ],
    }),
  },
  {
    args: makeArgs({
      route: makeRoute({
        hops: [
          makeHop({public_key: key(3), timeout: 500}),
          makeHop({
            channel: '0x0x2',
            fee_mtokens: '1',
            forward_mtokens: '1000000',
            public_key: key(2),
            timeout: 200,
          }),
          makeHop({channel: '0x0x3', public_key: key(4), timeout: 100}),
        ],
      }),
    }),
    description: 'A middle hop is described with its rate and long expiry',
    expected: makeExpected({
      description: [
        `${gray('0x0x1')} `,
        `${key(3)}. Fee rate: 100%`,
        gray('0x0x2x1'),
        `${key(2)}. Fee rate: 0.00% (1)${redBright(' Expiry +300')}`,
        gray('0x0x3x0'),
      ],
    }),
  },
  {
    args: makeArgs({
      route: makeRoute({
        hops: [
          makeHop({timeout: 300}),
          makeHop({
            channel: '0x0x2',
            encrypted_data: '00',
            path_key: key(2),
            public_key: key(2),
            timeout: 200,
          }),
          makeHop({
            channel: undefined,
            encrypted_data: '00',
            fee_mtokens: '0',
            forward_mtokens: undefined,
            public_key: key(4),
            timeout: undefined,
          }),
          makeHop({
            channel: undefined,
            encrypted_data: '00',
            public_key: key(5),
            timeout: undefined,
          }),
        ],
      }),
    }),
    description: 'Blinded hops are described without channels or rates',
    expected: makeExpected({
      description: [
        `${gray('0x0x1')} `,
        `${key(0)}. Fee rate: 100%`,
        gray('0x0x2x0'),
        `${key(2)}. Fee rate: 100%`,
        gray('blinded'),
        key(4),
        gray('blinded'),
      ],
    }),
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(describeRoute(args), error, 'Got expected error');
    } else {
      const got = await describeRoute(args);

      deepEqual(got, expected, 'Got expected route description');
    }

    return;
  });
});
