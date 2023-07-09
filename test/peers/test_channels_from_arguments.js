const {deepEqual} = require('node:assert').strict;
const test = require('node:test');
const {throws} = require('node:assert').strict;

const method = require('./../../peers/channels_from_arguments');

const makeArgs = overrides => {
  const args = {
    addresses: ['address'],
    capacities: [2],
    gives: ['1'],
    nodes: [Buffer.alloc(33, 3).toString('hex')],
    rates: [],
    saved: [],
    types: ['private'],
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({}),
    description: 'Arguments are mapped to channel details',
    expected: {
      opens: [{
        channels: [{
          capacity: 2,
          cooperative_close_address: 'address',
          description: 'bos open',
          fee_rate: undefined,
          give_tokens: 1,
          is_private: true,
          is_trusted_funding: false,
          node: undefined,
          partner_public_key: Buffer.alloc(33, 3).toString('hex'),
          rate: undefined,
        }],
      }],
    },
  },
  {
    args: makeArgs({
      addresses: [],
      capacities: [],
      gives: [],
      types: [],
    }),
    description: 'Remove optional arguments',
    expected: {
      opens: [{
        channels: [{
          capacity: 5000000,
          cooperative_close_address: undefined,
          description: 'bos open',
          fee_rate: undefined,
          give_tokens: undefined,
          is_private: false,
          is_trusted_funding: false,
          node: undefined,
          partner_public_key: Buffer.alloc(33, 3).toString('hex'),
          rate: undefined,
        }],
      }],
    },
  },
  {
    args: makeArgs({
      addresses: ['coopCloseAddressNodeA', 'coopCloseAddressNodeB'],
      capacities: [1, 2],
      gives: [3, 4],
      nodes: ['remoteNodeA', 'remoteNodeB'],
      rates: ['1', '2'],
      saved: ['savedA', 'savedB'],
      types: ['private', 'public'],
    }),
    description: 'Two nodes are batch opening',
    expected: {
      opens: [
        {
          channels: [{
            capacity: 1,
            cooperative_close_address: 'coopCloseAddressNodeA',
            description: 'bos open',
            fee_rate: 1,
            give_tokens: 3,
            is_private: true,
            is_trusted_funding: false,
            node: 'savedA',
            partner_public_key: 'remoteNodeA',
            rate: '1',
          }],
          node: 'savedA',
        },
        {
          channels: [{
            capacity: 2,
            cooperative_close_address: 'coopCloseAddressNodeB',
            description: 'bos open',
            fee_rate: 2,
            give_tokens: 4,
            is_private: false,
            is_trusted_funding: false,
            node: 'savedB',
            partner_public_key: 'remoteNodeB',
            rate: '2',
          }],
          node: 'savedB',
        },
      ],
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, (t, end) => {
    if (!!error) {
      throws(() => method(args), new Error(error), 'Got error');
    } else {
      const res = method(args);

      deepEqual(res, expected, 'Got expected result');
    }

    return end();
  });
});
