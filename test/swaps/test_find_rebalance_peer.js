const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const findRebalancePeer = require('./../../swaps/find_rebalance_peer');

const highKey = Buffer.alloc(33, 2).toString('hex');
const lowKey = Buffer.alloc(33, 3).toString('hex');
const inactiveKey = Buffer.alloc(33, 4).toString('hex');
const unknownKey = Buffer.alloc(33, 5).toString('hex');
const inboundFilters = ['inbound_liquidity > 10'];

const channels = [
  {
    capacity: 10,
    id: '1x1x1',
    local_balance: 4,
    partner_public_key: highKey,
    pending_payments: [],
    remote_balance: 6,
  },
  {
    capacity: 10,
    id: '2x2x2',
    local_balance: 4,
    partner_public_key: highKey,
    pending_payments: [],
    remote_balance: 6,
  },
  {
    capacity: 10,
    id: '3x3x3',
    local_balance: 2,
    partner_public_key: lowKey,
    pending_payments: [],
    remote_balance: 8,
  },
];

const makeLnd = aliases => ({
  default: {
    getNodeInfo: (args, cbk) => cbk(null, {
      channels: [],
      node: {
        addresses: [],
        alias: aliases[args.pub_key] || String(),
        color: '#000000',
        features: {},
        last_update: 0,
        pub_key: args.pub_key,
      },
      num_channels: 0,
      total_capacity: '1',
    }),
  },
});

const makeArgs = overrides => {
  const args = {
    channels,
    active_channels: channels,
    direction: 'out',
    filters: ['outbound_liquidity > 5'],
    lnd: makeLnd({[highKey]: 'alpha', [lowKey]: 'beta'}),
    policies: [],
    query: highKey,
    tags: [],
  };

  Object.keys(overrides).forEach(key => args[key] = overrides[key]);

  return args;
};

const tests = [
  {
    args: makeArgs({direction: undefined}),
    description: 'A known rebalance direction is required',
    error: [400, 'ExpectedInOrOutDirectionToFindRebalancePeer'],
  },
  {
    args: makeArgs({}),
    description: 'An explicit public key satisfying the filter is selected',
    expected: {public_key: highKey},
  },
  {
    args: makeArgs({query: highKey.toUpperCase()}),
    description: 'An uppercase public key is matched to the active peer',
    expected: {public_key: highKey},
  },
  {
    args: makeArgs({query: lowKey}),
    description: 'An explicit public key failing the filter is rejected',
    error: [400, 'NoPeerMatchesFoundToSatisfyOutboundFilter'],
  },
  {
    args: makeArgs({query: 'alpha'}),
    description: 'An explicit peer alias satisfying the filter is selected',
    expected: {public_key: highKey},
  },
  {
    args: makeArgs({query: 'beta'}),
    description: 'Only the explicitly aliased peer is tested by the filter',
    error: [400, 'NoPeerMatchesFoundToSatisfyOutboundFilter'],
  },
  {
    args: makeArgs({
      query: 'group',
      tags: [{alias: 'group', id: '00', nodes: [highKey, lowKey]}],
    }),
    description: 'An outbound tag continues to select a filtered peer',
    expected: {public_key: highKey},
  },
  {
    args: makeArgs({
      lnd: makeLnd({[highKey]: 'group'}),
      query: 'group',
      tags: [{alias: 'group', id: '00', nodes: [lowKey]}],
    }),
    description: 'A filtered-out tag does not fall through to a peer alias',
    error: [400, 'NoPeerMatchesFoundToSatisfyOutboundFilter'],
  },
  {
    args: makeArgs({
      channels: channels.concat({partner_public_key: inactiveKey}),
      lnd: makeLnd({[highKey]: 'inactive-tag'}),
      query: 'inactive-tag',
      tags: [{alias: 'inactive-tag', id: '00', nodes: [inactiveKey]}],
    }),
    description: 'A tag with no active peers does not fall through to an alias',
    error: [400, 'NoPeerMatchesFoundToSatisfyOutboundFilter'],
  },
  {
    args: makeArgs({
      query: 'group',
      tags: [
        {alias: 'group', id: '00', nodes: [highKey]},
        {alias: 'group', id: '11', nodes: [lowKey]},
      ],
    }),
    description: 'Ambiguous outbound tags remain rejected',
    error: [
      400,
      'MultipleTagMatchesFoundForOutPeer',
      {
        matches: [
          {alias: 'group', id: '00', nodes: [highKey]},
          {alias: 'group', id: '11', nodes: [lowKey]},
        ],
      },
    ],
  },
  {
    args: makeArgs({query: unknownKey}),
    description: 'An unknown explicit public key does not satisfy a filter',
    error: [400, 'NoPeerMatchesFoundToSatisfyOutboundFilter'],
  },
  {
    args: makeArgs({
      channels: channels.concat({partner_public_key: inactiveKey}),
      lnd: makeLnd({[inactiveKey]: 'inactive'}),
      query: 'inactive',
    }),
    description: 'An inactive aliased peer does not satisfy a filter',
    error: [400, 'NoPeerMatchesFoundToSatisfyOutboundFilter'],
  },
  {
    args: makeArgs({
      filters: ['invalid formula'],
      query: 'alpha',
    }),
    description: 'An invalid filter on an explicit alias is rejected',
    error: [
      400,
      'FailedToParseFilter',
      {
        error: 'UnexpectedTrailingTokenForFormulaParsing',
        formula: 'invalid formula',
      },
    ],
  },
  {
    args: makeArgs({filters: [], query: 'beta'}),
    description: 'An explicit alias is preserved when there are no filters',
    expected: {public_key: lowKey},
  },
  {
    args: makeArgs({
      channels: channels.concat({partner_public_key: inactiveKey}),
      filters: [],
      lnd: makeLnd({[inactiveKey]: 'inactive'}),
      query: 'inactive',
    }),
    description: 'An inactive alias still resolves when there are no filters',
    expected: {public_key: inactiveKey},
  },
  {
    args: makeArgs({query: undefined}),
    description: 'An outbound filter still requires an outbound selector',
    error: [400, 'NoPeerMatchesFoundToSatisfyOutboundFilter'],
  },
  {
    args: makeArgs({filters: [], query: undefined}),
    description: 'No selector and no filter preserves automatic selection',
    expected: {public_key: undefined},
  },
  {
    args: makeArgs({
      direction: 'in',
      filters: inboundFilters,
      query: highKey,
    }),
    description: 'An inbound public key satisfying the filter is selected',
    expected: {public_key: highKey},
  },
  {
    args: makeArgs({
      direction: 'in',
      filters: inboundFilters,
      query: lowKey,
    }),
    description: 'An inbound public key failing the filter is rejected',
    error: [400, 'NoPeerMatchesFoundToSatisfyInboundFilter'],
  },
  {
    args: makeArgs({
      direction: 'in',
      filters: inboundFilters,
      query: 'alpha',
    }),
    description: 'An inbound alias satisfying the filter is selected',
    expected: {public_key: highKey},
  },
  {
    args: makeArgs({
      direction: 'in',
      filters: inboundFilters,
      query: 'beta',
    }),
    description: 'Only the explicitly aliased inbound peer is filtered',
    error: [400, 'NoPeerMatchesFoundToSatisfyInboundFilter'],
  },
  {
    args: makeArgs({
      direction: 'in',
      filters: inboundFilters,
      query: 'group',
      tags: [{alias: 'group', id: '00', nodes: [highKey, lowKey]}],
    }),
    description: 'An inbound tag continues to select a filtered peer',
    expected: {public_key: highKey},
  },
  {
    args: makeArgs({
      direction: 'in',
      filters: inboundFilters,
      lnd: makeLnd({[highKey]: 'group'}),
      query: 'group',
      tags: [{alias: 'group', id: '00', nodes: [lowKey]}],
    }),
    description: 'A filtered inbound tag does not fall through to an alias',
    error: [400, 'NoPeerMatchesFoundToSatisfyInboundFilter'],
  },
  {
    args: makeArgs({
      direction: 'in',
      filters: inboundFilters,
      policies: [{is_disabled: true, public_key: highKey}],
      query: highKey,
    }),
    description: 'An inbound-disabled explicit peer fails the filter',
    error: [400, 'NoPeerMatchesFoundToSatisfyInboundFilter'],
  },
  {
    args: makeArgs({
      direction: 'in',
      filters: [],
      policies: [{is_disabled: true, public_key: highKey}],
      query: highKey,
    }),
    description: 'An inbound-disabled explicit peer resolves without filters',
    expected: {public_key: highKey},
  },
  {
    args: makeArgs({
      direction: 'in',
      filters: inboundFilters,
      query: 'group',
      tags: [
        {alias: 'group', id: '00', nodes: [highKey]},
        {alias: 'group', id: '11', nodes: [lowKey]},
      ],
    }),
    description: 'Ambiguous inbound tags remain rejected',
    error: [
      400,
      'MultipleTagMatchesFoundForInPeer',
      {
        matches: [
          {alias: 'group', id: '00', nodes: [highKey]},
          {alias: 'group', id: '11', nodes: [lowKey]},
        ],
      },
    ],
  },
  {
    args: makeArgs({
      direction: 'in',
      filters: inboundFilters,
      query: undefined,
    }),
    description: 'An inbound filter still requires an inbound selector',
    error: [400, 'NoPeerMatchesFoundToSatisfyInboundFilter'],
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(findRebalancePeer(args), error, 'Got expected error');
    } else {
      const res = await findRebalancePeer(args);

      deepEqual(res, expected, 'Got expected rebalance peer');
    }

    return;
  });
});
