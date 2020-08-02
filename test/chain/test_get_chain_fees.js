const {test} = require('tap');

const {getChainFees} = require('./../../chain');
const {getInfoResponse} = require('./../fixtures');

const getInfoRes = () => JSON.parse(JSON.stringify(getInfoResponse));

const tests = [
  {
    args: {},
    description: 'LND is required',
    error: [400, 'ExpectedLndToGetChainFees'],
  },
  {
    args: {
      lnd: {
        default: {getInfo: ({}, cbk) => cbk(null, getInfoRes())},
        wallet: {estimateFee: (args, cbk) => cbk('err')},
      },
    },
    description: 'Errors from get chain fee are passed back',
    error: [503, 'UnexpectedErrorGettingFeeFromLnd', {err: 'err'}],
  },
  {
    args: {
      lnd: {
        default: {getInfo: ({}, cbk) => cbk(null, getInfoRes())},
        wallet: {
          estimateFee: (args, cbk) => {
            return cbk(null, {
              sat_per_kw: 1 + Math.round(1 / args.conf_target),
            });
          },
        },
      },
    },
    description: 'Fees are mapped to levels',
    expected: {
      current_block_hash: '00',
      fee_by_block_target: {'2': 8, '3': 4},
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({deepIs, end, rejects}) => {
    if (!!error) {
      rejects(getChainFees(args), error, 'Got expected error');
    } else {
      const fees = await getChainFees(args);

      deepIs(fees, expected, 'Got expected fees rundown');
    }

    return end();
  });
});
