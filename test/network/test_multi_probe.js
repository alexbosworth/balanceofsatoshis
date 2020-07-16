const {test} = require('@alexbosworth/tap');

const multiProbe = require('./../../network/multi_probe');

const tests = [
  {
    args: {
      channels: [
        {
          id: 'channel-a1',
          local_balance: 1000000,
          local_reserve: 1000,
          partner_public_key: 'a',
        },
        {
          id: 'channel-a2',
          local_balance: 5000,
          local_reserve: 1000,
          partner_public_key: 'a',
        },
        {
          id: 'channel-a2',
          local_balance: 200000,
          local_reserve: 1000,
          partner_public_key: 'a',
        },
        {
          id: 'channel-e1-partially-used-up',
          local_balance: 1e8,
          local_reserve: 1e1,
          partner_public_key: 'e',
        },
      ],
      from: 'origin',
      ignore: [
        {
          from_public_key: 'd',
        },
      ],
      probes: [
        {
          relays: ['a', 'b', 'c'],
          route_maximum: 898000,
        },
        {
          relays: ['a', 'b', 'c'],
          route_maximum: 1e5,
        },
        {
          relays: ['a', 'b', 'c'],
          route_maximum: 150000,
        },
        {
          relays: ['e', 'f', 'g'],
          route_maximum: 100000,
        },
      ],
      tokens: 1e5,
    },
    description: 'A history of probes is mapped to updated probe parameters',
    expected: {
      ignore: [
        {
          from_public_key: 'd',
        },
        {
          from_public_key: 'origin',
          to_public_key: 'a',
        },
        {
          from_public_key: 'a',
          to_public_key: 'b',
        },
        {
          from_public_key: 'b',
          to_public_key: 'c',
        },
        {
          from_public_key: 'a',
          to_public_key: 'b',
        },
        {
          from_public_key: 'b',
          to_public_key: 'c',
        },
        {
          from_public_key: 'a',
          to_public_key: 'b',
        },
        {
          from_public_key: 'b',
          to_public_key: 'c',
        },
        {
          from_public_key: 'e',
          to_public_key: 'f',
        },
        {
          from_public_key: 'f',
          to_public_key: 'g',
        },
      ],
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({deepIs, end, equal, throws}) => {
    if (!!error) {
      throws(() => multiProbe(args), new Error(error), 'Got error');
    } else {
      const res = multiProbe(args);

      deepIs(res, expected, 'Got expected result');
    }

    return end();
  });
});
