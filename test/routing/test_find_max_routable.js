const {test} = require('tap');

const {findMaxRoutable} = require('./../../routing');
const {getInfoResponse} = require('./../network/fixtures');

const getInfoRes = () => JSON.parse(JSON.stringify(getInfoResponse));

const tests = [
  {
    args: {},
    description: 'A final cltv is required',
    error: [400, 'ExpectedFinalCltvToFindMaxRoutable'],
  },
  {
    args: {cltv: 1},
    description: 'Hops are required',
    error: [400, 'ExpectedArrayOfHopsToFindMaxRoutable'],
  },
  {
    args: {cltv: 1, hops: [{}]},
    description: 'Hops require channels',
    error: [400, 'ExpectedChannelsInHopsToFindMaxRoutable'],
  },
  {
    args: {cltv: 1, hops: [{channel: '0x0x0'}]},
    description: 'Hops require public keys',
    error: [400, 'ExpectedPublicKeyInHopsToFindMaxRoutable'],
  },
  {
    args: {cltv: 1, hops: [{channel: '0x0x0', public_key: 'a'}]},
    description: 'Logger is required to find max routable',
    error: [400, 'ExpectedLndToFindMaxRoutableAmount'],
  },
  {
    args: {cltv: 1, hops: [{channel: '0x0x0', public_key: 'a'}], lnd: {}},
    description: 'Logger is required to find max routable',
    error: [400, 'ExpectedLoggerToFindMaxRoutable'],
  },
  {
    args: {
      cltv: 1,
      hops: [{channel: '0x0x0', public_key: 'a'}],
      lnd: {},
      logger: {},
    },
    description: 'Max limit is required to find max routable',
    error: [400, 'ExpectedMaxLimitTokensToFindMaxRoutable'],
  },
  {
    args: {
      cltv: 1,
      hops: [{channel: '0x0x0', public_key: 'a'}],
      lnd: {default: {getChanInfo: ({channel}, cbk) => cbk('err')}},
      logger: {},
      max: 1e6,
    },
    description: 'Get channel errors are passed back',
    error: [503, 'UnexpectedGetChannelInfoError', {err: 'err'}],
  },
  {
    args: {
      cltv: 1,
      hops: [{channel: '0x0x0', public_key: 'a'}],
      lnd: {
        default: {
          getChanInfo: ({channel}, cbk) => cbk(null, {
            capacity: '1',
            chan_point: '1:1',
            channel_id: 1,
            node1_policy: {
              disabled: false,
              fee_base_msat: '1',
              fee_rate_milli_msat: '1',
              last_update: 1,
              max_htlc_msat: '1',
              min_htlc: '1',
              time_lock_delta: 1,
            },
            node1_pub: 'a',
            node2_policy: {
              disabled: false,
              fee_base_msat: '2',
              fee_rate_milli_msat: '2',
              last_update: 2,
              max_htlc_msat: '2',
              min_htlc: '2',
              time_lock_delta: 2,
            },
            node2_pub: 'b',
          }),
          getInfo: ({}, cbk) => cbk(null, getInfoRes()),
        },
        router: {
          sendToRoute: ({}, cbk) => cbk(null, {
            failure: {code: 'UNKNOWN_PAYMENT_HASH'},
          }),
        },
      },
      logger: {
        info: n => {
          if (!n.evaluating_amount) {
            throw new Error('ExpectedEvaluationAmountLogged');
          }

          return;
        },
      },
      max: 1e6,
    },
    description: 'Get maximum finds rough maximum',
    expected: {maximum: 999000},
  },
  {
    args: {
      cltv: 1,
      hops: [{channel: '0x0x0', public_key: 'a'}],
      lnd: {
        default: {
          getChanInfo: ({channel}, cbk) => cbk(null, {
            capacity: '1',
            chan_point: '1:1',
            channel_id: 1,
            node1_policy: {
              disabled: false,
              fee_base_msat: '1',
              fee_rate_milli_msat: '1',
              last_update: 1,
              max_htlc_msat: '1',
              min_htlc: '1',
              time_lock_delta: 1,
            },
            node1_pub: 'a',
            node2_policy: {
              disabled: false,
              fee_base_msat: '2',
              fee_rate_milli_msat: '2',
              last_update: 2,
              max_htlc_msat: '2',
              min_htlc: '2',
              time_lock_delta: 2,
            },
            node2_pub: 'b',
          }),
          getInfo: ({}, cbk) => cbk('err'),
        },
        router: {
          sendToRoute: ({}, cbk) => cbk(null, {
            failure: {code: 'UNKNOWN_PAYMENT_HASH'},
          }),
        },
      },
      logger: {
        info: n => {
          if (!n.evaluating_amount) {
            throw new Error('ExpectedEvaluationAmountLogged');
          }

          return;
        },
      },
      max: 1e6,
    },
    description: 'Get maximum finds rough maximum',
    error: [503, 'GetWalletInfoErr', {err: 'err'}],
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects}) => {
    if (!!error) {
      rejects(findMaxRoutable(args), error, 'Got expected error');
    } else {
      const {maximum} = await findMaxRoutable(args);

      equal(maximum > expected.maximum - 1000, true, 'Got expected maximum');
    }

    return end();
  });
});
