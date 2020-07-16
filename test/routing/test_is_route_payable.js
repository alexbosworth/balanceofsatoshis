const {test} = require('@alexbosworth/tap');

const {getInfoResponse} = require('./../fixtures');

const isRoutePayable = require('./../../routing/is_route_payable');

const getInfoRes = () => JSON.parse(JSON.stringify(getInfoResponse));

const tests = [
  {
    args: {},
    description: 'An array of channels for the route is required',
    error: [400, 'ExpectedArrayOfChannelsToTestRoutePayable'],
  },
  {
    args: {channels: []},
    description: 'A final cltv delta is required',
    error: [400, 'ExpectedFinalCltvDeltaToTestRoutePayable'],
  },
  {
    args: {channels: [], cltv: 1},
    description: 'LND object is required',
    error: [400, 'ExpectedLndToTestRoutePayable'],
  },
  {
    args: {channels: [], cltv: 1, lnd: {}},
    description: 'Tokens are required',
    error: [400, 'ExpectedTokensToTestRoutePayable'],
  },
  {
    args: {
      channels: [{
        capacity: 1,
        destination: 'b',
        id: '0x0x0',
        policies: [
          {
            base_fee_mtokens: '1',
            cltv_delta: 1,
            fee_rate: 1,
            is_disabled: false,
            min_htlc_mtokens: '1',
            public_key: 'a',
          },
          {
            base_fee_mtokens: '2',
            cltv_delta: 2,
            fee_rate: 2,
            is_disabled: false,
            min_htlc_mtokens: '2',
            public_key: 'b',
          },
        ],
      }],
      cltv: 1,
      lnd: {
        default: {getInfo: ({}, cbk) => cbk(null, getInfoRes())},
        router: {
          buildRoute: ({}, cbk) => cbk('err'),
          sendToRoute: ({}, cbk) => cbk(null, {
            failure: {code: 'UNKNOWN_PAYMENT_HASH'},
          },
        )},
      },
      tokens: 1,
    },
    description: 'Unknown hash means payment is possible',
    expected: {is_payable: true},
  },
  {
    args: {
      channels: [{
        capacity: 1,
        destination: 'b',
        id: '0x0x0',
        policies: [
          {
            base_fee_mtokens: '1',
            cltv_delta: 1,
            fee_rate: 1,
            is_disabled: false,
            min_htlc_mtokens: '1',
            public_key: 'a',
          },
          {
            base_fee_mtokens: '2',
            cltv_delta: 2,
            fee_rate: 2,
            is_disabled: false,
            min_htlc_mtokens: '2',
            public_key: 'b',
          },
        ],
      }],
      cltv: 1,
      lnd: {default: {getInfo: ({}, cbk) => cbk(null, getInfoRes())}},
      tokens: 1,
    },
    description: 'Invoice is not payable',
    expected: {is_payable: false},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects}) => {
    if (!!error) {
      rejects(isRoutePayable(args), error, 'Got expected error');
    } else {
      const payable = await isRoutePayable(args);

      equal(payable.is_payable, expected.is_payable, 'Got is_payable');
    }

    return end();
  });
});
