const {test} = require('tap');

const {getInfoResponse} = require('./../fixtures');
const {listChannelsResponse} = require('./../fixtures');
const pushPayment = require('./../../network/push_payment');

const getInfoRes = () => JSON.parse(JSON.stringify(getInfoResponse));

const makeLnd = ({}) => {
  return {
    default: {
      getInfo: ({}, cbk) => cbk(null, getInfoRes()),
      listChannels: ({}, cbk) => cbk(null, listChannelsResponse),
    },
  };
};

const makeArgs = overrides => {
  const args = {
    amount: 'IF(LIQUIDITY<1,2*USD,INBOUND*EUR)',
    destination: '000000000000000000000000000000000000000000000000000000000000000000',
    is_dry_run: true,
    lnd: makeLnd({}),
    logger: {info: () => {}},
    max_fee: 0,
    message: 'message',
    request: ({}, cbk) => cbk(null, {statusCode: 200}, {
      rates: {
        btc: {
          name: 'Bitcoin',
          type: 'crypto',
          unit: 'BTC',
          value: 1,
        },
        eur: {
          name: 'Euro',
          type: 'fiat',
          unit: '€',
          value: 16000,
        },
        ltc: {
          name: 'Litecoin',
          type: 'crypto',
          unit: 'LTC',
          value: 231,
        },
        usd: {
          name: 'US Dollar',
          type: 'fiat',
          unit: '$',
          value: 20000,
        },
      },
    }),
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({}),
    description: 'Payment dry run results in error',
    error: [400, 'PushPaymentDryRun'],
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({deepIs, end, rejects}) => {
    if (!!error) {
      await rejects(pushPayment(args), error, 'Got expected error');
    } else {
      const res = await pushPayment(args);
    }

    return end();
  });
});
