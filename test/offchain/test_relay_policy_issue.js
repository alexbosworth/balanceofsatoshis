const {deepEqual} = require('node:assert').strict;
const test = require('node:test');

const relayPolicyIssue = require('./../../offchain/relay_policy_issue');

const makePolicy = overrides => {
  const policy = {
    base_fee_mtokens: '1000',
    cltv_delta: 40,
    fee_rate: 100,
    is_disabled: false,
    max_htlc_mtokens: '990000000',
    min_htlc_mtokens: '1000',
    public_key: Buffer.alloc(33, 2).toString('hex'),
  };

  Object.keys(overrides).forEach(k => policy[k] = overrides[k]);

  return policy;
};

const tests = [
  {
    args: {mtokens: '1000000'},
    description: 'A missing policy cannot relay',
    expected: {issue: 'peer routing policy for the channel is unknown'},
  },
  {
    args: {mtokens: '1000000', policy: makePolicy({is_disabled: true})},
    description: 'A disabled policy cannot relay',
    expected: {issue: 'peer disabled forwarding over the channel'},
  },
  {
    args: {
      mtokens: '1000000',
      policy: makePolicy({base_fee_mtokens: undefined}),
    },
    description: 'A policy without a base fee cannot relay',
    expected: {issue: 'peer routing policy for the channel is unknown'},
  },
  {
    args: {mtokens: '1000000', policy: makePolicy({cltv_delta: undefined})},
    description: 'A policy without a cltv delta cannot relay',
    expected: {issue: 'peer routing policy for the channel is unknown'},
  },
  {
    args: {mtokens: '1000000', policy: makePolicy({fee_rate: undefined})},
    description: 'A policy without a fee rate cannot relay',
    expected: {issue: 'peer routing policy for the channel is unknown'},
  },
  {
    args: {
      mtokens: '1000000',
      policy: makePolicy({max_htlc_mtokens: undefined}),
    },
    description: 'A policy without a max htlc cannot relay',
    expected: {issue: 'peer HTLC limits for the channel are unknown'},
  },
  {
    args: {
      mtokens: '1000000',
      policy: makePolicy({min_htlc_mtokens: undefined}),
    },
    description: 'A policy without a min htlc cannot relay',
    expected: {issue: 'peer HTLC limits for the channel are unknown'},
  },
  {
    args: {mtokens: 1000000, policy: makePolicy({})},
    description: 'Millitokens must be a numeric string',
    expected: {issue: 'amount is not a valid millitokens amount'},
  },
  {
    args: {mtokens: '999', policy: makePolicy({})},
    description: 'A payment below the min htlc cannot be relayed',
    expected: {issue: 'amount is below the peer minimum HTLC size'},
  },
  {
    args: {mtokens: '990000001', policy: makePolicy({})},
    description: 'A payment above the max htlc cannot be relayed',
    expected: {issue: 'amount is above the peer maximum HTLC size'},
  },
  {
    args: {mtokens: '1000', policy: makePolicy({})},
    description: 'A payment at the min htlc can be relayed',
    expected: {},
  },
  {
    args: {mtokens: '990000000', policy: makePolicy({base_fee_mtokens: '0'})},
    description: 'A payment at the max htlc can be relayed for a zero base fee',
    expected: {},
  },
];

tests.forEach(({args, description, expected}) => {
  return test(description, () => {
    deepEqual(relayPolicyIssue(args), expected, 'Got expected policy issue');

    return;
  });
});
