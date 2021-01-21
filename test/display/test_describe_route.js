const {test} = require('tap');

const {describeRoute} = require('./../../display');

const makeArgs = overrides => {
  const args = {
    lnd: {default: {getNodeInfo: ({}, cbk) => cbk('err')}},
    route: {
      confidence1: 1,
      fee: 1,
      fee_mtokens: '1000',
      hops: [{
        channel: '0x0x1',
        channel_capacity: 1,
        fee: 1,
        fee_mtokens: '1000',
        forward: 1,
        forward_mtokens: '1000',
        public_key: Buffer.alloc(33).toString('hex'),
        timeout: 1,
      }],
      mtokens: '1000',
      safe_fee: 1,
      safe_tokens: 1,
      timeout: 1,
      tokens: 1,
    },
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({}),
    description: 'A route is described',
    expected: {
      description: [
        '\u001b[90m0x0x1\u001b[39m ',
        '000000000000000000000000000000000000000000000000000000000000000000. Fee rate: 100%',
      ],
    },
  },
  {
    args: makeArgs({
      route: {
        confidence1: 1e6,
        fee: 1,
        fee_mtokens: '1000',
        hops: [
          {
            channel: '0x0x1',
            channel_capacity: 1,
            fee: 1,
            fee_mtokens: '1000',
            forward: 1,
            forward_mtokens: '1000',
            public_key: Buffer.alloc(33).toString('hex'),
            timeout: 1,
          },
          {
            channel: '0x0x2',
            channel_capacity: 1,
            fee: 1,
            fee_mtokens: '1000',
            forward: 1,
            forward_mtokens: '1000',
            public_key: Buffer.alloc(33, 2).toString('hex'),
            timeout: 1,
          },
        ],
        mtokens: '1000',
        safe_fee: 1,
        safe_tokens: 1,
        timeout: 1,
        tokens: 1,
      },
    }),
    description: 'A two hop route is described',
    expected: {
      description: [
        '\u001b[90m0x0x1\u001b[39m ',
        '000000000000000000000000000000000000000000000000000000000000000000. Fee rate: 100%',
        '\u001b[90m0x0x2\u001b[39m',
      ],
    },
  },
];

tests.forEach(({args, description, expected}) => {
  return test(description, async ({deepIs, end, equal, rejects}) => {
    const description = await describeRoute(args);

    deepIs(description, expected, 'Got expected route description');

    return end();
  });
});
