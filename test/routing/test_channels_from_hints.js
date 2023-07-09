const {deepEqual} = require('node:assert').strict;
const test = require('node:test');
const {throws} = require('node:assert').strict;

const {channelsFromHints} = require('./../../routing');

const tests = [
  {
    args: {},
    description: 'No request means no channels',
    expected: {channels: []},
  },
  {
    args: {
      request: 'lnbc1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq8rkx3yf5tcsyz3d73gafnh3cax9rn449d9p5uxz9ezhhypd0elx87sjle52x86fux2ypatgddc6k63n7erqz25le42c4u4ecky03ylcqca784w',
    },
    description: 'No hop hints means no channels',
    expected: {channels: []},
  },
  {
    args: {
      request: 'lnbc20m1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqhp58yjmdan79s6qqdhdzgynm4zwqd5d7xmw5fk98klysy043l2ahrqsfpp3qjmp7lwpagxun9pygexvgpjdc4jdj85fr9yq20q82gphp2nflc7jtzrcazrra7wwgzxqc8u7754cdlpfrmccae92qgzqvzq2ps8pqqqqqqpqqqqq9qqqvpeuqafqxu92d8lr6fvg0r5gv0heeeqgcrqlnm6jhphu9y00rrhy4grqszsvpcgpy9qqqqqqgqqqqq7qqzqj9n4evl6mr5aj9f58zp6fyjzup6ywn3x6sk8akg5v4tgn2q8g4fhx05wf6juaxu9760yp46454gpg5mtzgerlzezqcqvjnhjh8z3g2qqdhhwkj',
    },
    description: 'Hop hints are mapped to channels',
    expected: {
      channels: [
        {
          capacity: 9007199254740991,
          destination: '039e03a901b85534ff1e92c43c74431f7ce72046060fcf7a95c37e148f78c77255',
          id: '66051x263430x1800',
          policies: [
            {
              base_fee_mtokens: '1',
              cltv_delta: 3,
              fee_rate: 20,
              public_key: '029e03a901b85534ff1e92c43c74431f7ce72046060fcf7a95c37e148f78c77255',
            },
            {
              public_key: '039e03a901b85534ff1e92c43c74431f7ce72046060fcf7a95c37e148f78c77255',
            },
          ],
        },
        {
          capacity: 9007199254740991,
          destination: '03e7156ae33b0a208d0744199163177e909e80176e55d97a2f221ede0f934dd9ad',
          id: '197637x395016x2314',
          policies: [
            {
              base_fee_mtokens: '2',
              cltv_delta: 4,
              fee_rate: 30,
              public_key: '039e03a901b85534ff1e92c43c74431f7ce72046060fcf7a95c37e148f78c77255',
            },
            {
              public_key: '03e7156ae33b0a208d0744199163177e909e80176e55d97a2f221ede0f934dd9ad',
            },
          ],
        },
      ],
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, (t, end) => {
    if (!!error) {
      throws(() => channelsFromHints(args), new Error(error), 'Got error');
    } else {
      const res = channelsFromHints(args);

      deepEqual(res, expected, 'Got expected result');
    }

    return end();
  });
});
