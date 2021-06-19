const {test} = require('@alexbosworth/tap');

const {getChannelCloses} = require('./../../chain');
const {getInfoResponse} = require('./../fixtures');

const getInfoRes = () => JSON.parse(JSON.stringify(getInfoResponse));

const makeLnd = ({}) => {
  return {
    default: {getInfo: ({}, cbk) => getInfoRes()},
  };
};

const tests = [
  {
    args: {},
    description: 'LND is required',
    error: [400, 'ExpectedLndToGetChannelCloses'],
  },
  {
    args: {lnd: makeLnd({})},
    description: 'Request is required',
    error: [400, 'ExpectedRequestFunctionToGetChannelCloses'],
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, rejects, strictSame}) => {
    if (!!error) {
      await rejects(getChannelCloses(args), error, 'Got expected error');
    } else {
      const closes = await getChannelCloses(args);

      strictSame(closes, expected, 'Got expected closed channels');
    }

    return end();
  });
});
